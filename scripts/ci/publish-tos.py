"""Publish validated desktop artifacts; write the channel pointer only after all uploads succeed."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sys
from tempfile import TemporaryDirectory
from threading import Lock
from time import monotonic
from urllib.parse import quote, urlsplit, urlunsplit
from xml.etree import ElementTree


# The desktop updater accepts installers up to 1 GiB. Fail before uploads.
MAX_ARTIFACT_BYTES = 1024 ** 3

VERSION = re.compile(r'(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-beta\.(0|[1-9]\d*))?')


def version_key(version):
    match = VERSION.fullmatch(version)
    if not match:
        raise ValueError('Unsupported release version')
    major, minor, patch, beta = match.groups()
    return (int(major), int(minor), int(patch), beta is None, int(beta or 0))


def settings(env, check_signing=False):
    names = ['TOS_ACCESS_KEY_ID', 'TOS_SECRET_ACCESS_KEY', 'TOS_REGION', 'TOS_ENDPOINT', 'TOS_PUBLIC_BASE_URL']
    missing = [name for name in names if not env.get(name, '').strip()]
    if missing:
        raise ValueError('Missing configuration: ' + ', '.join(missing))
    result = {name: env[name].strip() for name in names}
    result['TOS_BUCKET'] = env.get('TOS_BUCKET', 'dofe-public').strip() or 'dofe-public'
    if result['TOS_BUCKET'] != 'dofe-public':
        raise ValueError('This publisher is scoped to dofe-public')
    endpoint = result['TOS_ENDPOINT']
    if '://' not in endpoint:
        endpoint = 'https://' + endpoint
    result['TOS_ENDPOINT'] = endpoint.rstrip('/')
    for name in ['TOS_ENDPOINT', 'TOS_PUBLIC_BASE_URL']:
        parsed = urlsplit(result[name])
        if (parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password
                or parsed.query or parsed.fragment):
            raise ValueError(name + ' must be an HTTPS URL without credentials, query or fragment')
        if name == 'TOS_ENDPOINT' and parsed.path not in ['', '/']:
            raise ValueError('TOS_ENDPOINT must be a service endpoint without a path')
    parsed = urlsplit(result['TOS_ENDPOINT'])
    host = parsed.hostname
    bucket_prefix = result['TOS_BUCKET'] + '.'
    if host.startswith(bucket_prefix):
        host = host[len(bucket_prefix):]
    # TOS4 signatures belong to the native service, not the S3 compatibility endpoint.
    official = re.fullmatch(r'tos-(s3-)?([a-z0-9-]+)\.volces\.com', host)
    if official:
        if official[2] != result['TOS_REGION']:
            raise ValueError('TOS_REGION does not match the region in TOS_ENDPOINT')
        if official[1]:
            print('TOS endpoint: using the native endpoint for the configured S3 service region.', flush=True)
        host = 'tos-' + official[2] + '.volces.com'
        result['TOS_ENDPOINT'] = urlunsplit(('https', host + (f':{parsed.port}' if parsed.port else ''), '', '', ''))
    if check_signing and env.get('RELEASE') == 'true':
        signing = ['MAC_CERT_P12_BASE64', 'MACOS_SIGN_IDENTITY', 'CSC_KEY_PASSWORD',
                   'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']
        missing = [name for name in signing if not env.get(name, '').strip()]
        if missing:
            raise ValueError('Signed macOS release requires: ' + ', '.join(missing))
    return result


def release_context(env):
    version = env['DESKTOP_VERSION']
    version_key(version)
    sha = env['GITHUB_SHA']
    upstream_sha = env['UPSTREAM_SHA']
    if not all(re.fullmatch(r'[a-f0-9]{40}', value) for value in [sha, upstream_sha]):
        raise ValueError('Both source commits must be full SHA values')
    run_id, attempt = env['GITHUB_RUN_ID'], env['GITHUB_RUN_ATTEMPT']
    if not all(re.fullmatch(r'[1-9]\d*', value) for value in [run_id, attempt]):
        raise ValueError('Invalid workflow run identity')
    release = env.get('RELEASE') == 'true'
    channel = 'beta' if '-beta.' in version else 'stable'
    base = f'sensteed-agent/releases/{channel}/{version}' if release else f'sensteed-agent/candidates/{sha}'
    return dict(version=version, channel=channel, release=release, commit=sha,
                upstreamCommit=upstream_sha, runId=run_id, runAttempt=attempt,
                prefix=f'{base}/{run_id}-{attempt}')


def inventory(directory, context, public_url):
    """Require every platform, reject unexpected files, and hash files without loading installers into memory."""
    expected = {'macos': ['.dmg'], 'windows': ['-Setup.exe', '-Portable.zip'], 'linux': ['.AppImage', '.deb']}
    files = []
    for platform, suffixes in expected.items():
        folder = directory / platform
        if folder.is_symlink() or not folder.is_dir():
            raise ValueError('Missing artifact platform: ' + platform)
        entries = list(folder.iterdir())
        if len(entries) != len(suffixes):
            raise ValueError('Unexpected artifact count for ' + platform)
        for suffix in suffixes:
            matches = [path for path in entries if path.name.endswith(suffix)]
            if len(matches) != 1:
                raise ValueError('Missing or duplicate artifact: ' + platform + suffix)
            path = matches[0]
            if path.is_symlink() or not path.is_file() or path.stat().st_size == 0:
                raise ValueError('Artifact must be a nonempty regular file')
            if path.stat().st_size > MAX_ARTIFACT_BYTES:
                raise ValueError('Artifact exceeds the 1 GiB updater size limit: ' + path.name)
            # electron-builder uses target-specific names for the same x64 architecture.
            architecture = {'.AppImage': '(?:x64|x86_64)', '.deb': '(?:x64|amd64)'}.get(suffix, 'x64')
            tail = r'(?:-universal)?\.dmg' if platform == 'macos' else '-' + architecture + re.escape(suffix)
            if (not re.fullmatch(r'[A-Za-z0-9._ -]+', path.name)
                    or not re.search(r'(?<![0-9.])' + re.escape(context['version']) + tail + '$', path.name)):
                raise ValueError(
                    f"Invalid {platform} artifact {path.name!r}: expected exact version "
                    f"{context['version']} and a supported architecture suffix for {suffix}")
            digest = hashlib.sha256()
            with path.open('rb') as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                    digest.update(chunk)
            key = f"{context['prefix']}/{platform}/{path.name}"
            files.append(dict(platform=platform, arch='universal' if platform == 'macos' else 'x64',
                              name=path.name, size=path.stat().st_size,
                              sha256=digest.hexdigest(), key=key,
                              url=public_url.rstrip('/') + '/' + quote(key, safe='/'),
                              signing='signed-notarized' if platform == 'macos' and context['release'] else 'unsigned'))
    return files


def diagnostic(error, env):
    """Allowlist SDK diagnostics; never serialize its headers, URL, body or exception repr."""
    fields = {'type': type(error).__name__}
    for name in ['status_code', 'code', 'request_id', 'ec', 'message']:
        value = getattr(error, name, None)
        if value is not None:
            fields[name] = str(value)
    message = fields.get('message', '')
    if message.lstrip().startswith('<'):
        # S3 errors are XML; ArgumentValue can echo an entire Authorization header.
        fields.pop('message', None)
        if len(message) <= 65536 and '<!DOCTYPE' not in message and '<!ENTITY' not in message:
            try:
                root = ElementTree.fromstring(message)
                for tag, name in [('Code', 'code'), ('RequestId', 'request_id'), ('EC', 'ec'), ('Message', 'message')]:
                    value = root.findtext(tag)
                    if value:
                        fields[name] = value
            except ElementTree.ParseError:
                fields['message'] = 'Unparseable service error body omitted'
    if isinstance(error, (ValueError, KeyError)):
        fields['message'] = str(error)
    for name, value in fields.items():
        for secret in sorted((value for key, value in env.items() if key.startswith('TOS_') and value),
                             key=len, reverse=True):
            value = value.replace(secret, '[redacted]').replace(quote(secret, safe=''), '[redacted]')
        value = re.sub(r'(?:TOS4|AWS4)-HMAC-SHA256[^\r\n]*', '[redacted-authorization]', value)
        value = re.sub(r'https?://[^\s<>]+', '[redacted-url]', value)
        fields[name] = value[:1000]
    return 'TOS publication failed: ' + json.dumps(fields, ensure_ascii=True)


def probe(client, config, env):
    """Exercise the same multipart and HEAD operations with a tiny, isolated object."""
    run_id, attempt = env['GITHUB_RUN_ID'], env['GITHUB_RUN_ATTEMPT']
    if not all(re.fullmatch(r'[1-9]\d*', value) for value in [run_id, attempt]):
        raise ValueError('Invalid workflow run identity')
    key = f'sensteed-agent/diagnostics/{run_id}-{attempt}/probe.txt'
    payload = b'Sensteed CI TOS multipart probe\n'
    checksum = hashlib.sha256(payload).hexdigest()
    with TemporaryDirectory() as directory:
        path = Path(directory) / 'probe.txt'
        path.write_bytes(payload)
        print('TOS probe: multipart upload', flush=True)
        client.upload_file(config['TOS_BUCKET'], key, str(path), task_num=1, enable_checkpoint=False,
                           content_type='text/plain', meta={'sha256': checksum}, cache_control='no-store')
    print('TOS probe: verify uploaded object', flush=True)
    head = client.head_object(config['TOS_BUCKET'], key)
    if head.content_length != len(payload) or head.meta.get('sha256') != checksum:
        raise ValueError('TOS probe verification failed')
    print('TOS multipart upload and HEAD verification passed.', flush=True)


def read_channel(client, bucket, key):
    try:
        response = client.get_object(bucket, key)
    except Exception as error:
        if getattr(error, 'status_code', None) == 404 and getattr(error, 'code', None) == 'NoSuchKey':
            return None, None
        raise
    return json.loads(response.read()), response.etag


class UploadProgress:
    """Report SDK transfer and multipart events without exposing request details."""
    def __init__(self, item):
        self.label = f"{item['platform']}/{item['name']}"
        self.size = item['size']
        self.started = self.last_report = monotonic()
        self.confirmed = 0
        self.lock = Lock()

    def transfer(self, consumed_bytes, total_bytes, rw_once_bytes, transfer_type):
        with self.lock:
            now = monotonic()
            if now - self.last_report < 30:
                return
            self.last_report = now
            elapsed = now - self.started
            # SDK transfer counters include bytes sent again during request retries.
            print(f'TOS transfer: {self.label}; sent={consumed_bytes} bytes (including retries); '
                  f'elapsed={elapsed:.0f}s; average={consumed_bytes / elapsed / 1024 / 1024:.2f} MiB/s',
                  flush=True)

    def event(self, event_type, error, bucket, key, upload_id, file_path, checkpoint_file, part_info):
        with self.lock:
            elapsed = monotonic() - self.started
            if event_type.name == 'Upload_Event_Upload_Part_Succeed':
                self.confirmed += part_info.part_size
                print(f'TOS progress: {self.label}; confirmed={self.confirmed}/{self.size} bytes '
                      f'({self.confirmed / self.size:.1%}); part={part_info.part_number}; '
                      f'elapsed={elapsed:.0f}s', flush=True)
            else:
                print(f'TOS multipart: {self.label}; event={event_type.name}; elapsed={elapsed:.0f}s',
                      flush=True)


def publish(client, config, context, directory):
    bucket = config['TOS_BUCKET']
    files = inventory(directory, context, config['TOS_PUBLIC_BASE_URL'])
    channel_key = f"sensteed-agent/channels/{context['channel']}.json"
    etag = None
    if context['release']:
        previous, etag = read_channel(client, bucket, channel_key)
        if previous and version_key(previous['version']) >= version_key(context['version']):
            raise ValueError('Release must be newer than the published channel version')
    for item in files:
        print(f"TOS upload: {item['platform']}/{item['name']} ({item['size']} bytes)", flush=True)
        progress = UploadProgress(item)
        client.upload_file(bucket, item['key'], str(directory / item['platform'] / item['name']),
                           task_num=4, enable_checkpoint=False,
                           data_transfer_listener=progress.transfer,
                           upload_event_listener=progress.event,
                           content_type='application/octet-stream',
                           cache_control='public, max-age=31536000, immutable',
                           meta={'sha256': item['sha256']})
        print(f"TOS verify: {item['platform']}/{item['name']}", flush=True)
        head = client.head_object(bucket, item['key'])
        if head.content_length != item['size'] or head.meta.get('sha256') != item['sha256']:
            raise ValueError('Uploaded artifact verification failed for ' + item['platform'])
        print(f"TOS download: {item['platform']}/{item['name']} -> {item['url']}", flush=True)
    manifest = {**context, 'formatVersion': 1, 'artifacts': files}
    body = (json.dumps(manifest, indent=2, ensure_ascii=True) + '\n').encode()
    manifest_key = context['prefix'] + '/manifest.json'
    print('TOS write: version manifest', flush=True)
    client.put_object(bucket, manifest_key, content=body, content_type='application/json',
                      cache_control='public, max-age=31536000, immutable', forbid_overwrite=True)
    manifest_url = config['TOS_PUBLIC_BASE_URL'].rstrip('/') + '/' + quote(manifest_key, safe='/')
    print(f'TOS manifest download: {manifest_url}', flush=True)
    if context['release']:
        # Compare-and-swap also protects against another workflow or an external publisher.
        condition = {'if_match': etag} if etag else {'forbid_overwrite': True}
        print('TOS write: channel index', flush=True)
        client.put_object(bucket, channel_key, content=body, content_type='application/json',
                          cache_control='no-store', **condition)
    return manifest_key, manifest


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check-config', action='store_true')
    parser.add_argument('--probe', action='store_true')
    parser.add_argument('--artifacts', type=Path, default=Path('artifacts'))
    args = parser.parse_args()
    config = settings(os.environ, check_signing=args.check_config)
    if args.check_config:
        print('TOS configuration is present; no secret values printed.')
        if not args.probe:
            return
    import tos
    client = tos.TosClientV2(ak=config['TOS_ACCESS_KEY_ID'], sk=config['TOS_SECRET_ACCESS_KEY'],
                             endpoint=config['TOS_ENDPOINT'], region=config['TOS_REGION'],
                             enable_crc=True, max_retry_count=3)
    if args.probe:
        probe(client, config, os.environ)
        return
    context = release_context(os.environ)
    key, manifest = publish(client, config, context, args.artifacts)
    summary = ['## TOS artifacts', '', f"Version: `{context['version']}`", '',
               f"Manifest: `{key}`", '', '| Platform | File | SHA-256 |', '| --- | --- | --- |']
    summary += [f"| {item['platform']} | [{item['name']}]({item['url']}) | `{item['sha256']}` |"
                for item in manifest['artifacts']]
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as output:
            output.write('\n'.join(summary) + '\n')
    print('Published five installers and their manifest to dofe-public.')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(diagnostic(error, os.environ), file=sys.stderr)
        sys.exit(1)
