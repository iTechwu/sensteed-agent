"""Upload immutable CI artifacts and signed provenance; Models alone owns release channels."""
import argparse
import base64
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import subprocess
from tempfile import TemporaryDirectory
from threading import Lock
from time import monotonic
from urllib.parse import quote, urlsplit, urlunsplit
from xml.etree import ElementTree


VERSION = re.compile(r'(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?')


def version_key(version):
    match = VERSION.fullmatch(version)
    if not match:
        raise ValueError('Unsupported release version')
    major, minor, patch, prerelease = match.groups()
    identifiers = prerelease.split('.') if prerelease else []
    if any(value.isdigit() and len(value) > 1 and value.startswith('0') for value in identifiers):
        raise ValueError('Unsupported release version')
    if prerelease and not re.search(r'(?:^beta\.(0|[1-9]\d*)$|-beta\.[1-9]\d{11}$)', prerelease):
        raise ValueError('Unsupported release version')
    # Normal SemVer ordering. Cross-generation migration is an explicit Models decision.
    return (int(major), int(minor), int(patch), prerelease is None,
            tuple((0, int(value)) if value.isdigit() else (1, value) for value in identifiers))


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
    for name in ['DESKTOP_RELEASE_MANIFEST_SIGNING_KEY_PEM', 'DESKTOP_RELEASE_MANIFEST_SIGNING_KEY_ID']:
        if env.get(name, '').strip():
            result[name] = env[name].strip()
    # Fail before uploads, including partial/malformed candidate signer configuration.
    sign_manifest(b'configuration-check', result, required=env.get('RELEASE') == 'true')
    return result


def upload_stamp(version):
    """yymmddhh 目录层:优先版本号自带时间戳(-beta.YYYYMMDDHHmm,与 tag 一致
    且重跑稳定),否则回退 run 时刻(团队时区 UTC+8)。"""
    timestamped = re.search(r'-beta\.(\d{12})$', version or '')
    if timestamped:
        return timestamped.group(1)[2:10]
    return datetime.now(timezone(timedelta(hours=8))).strftime('%y%m%d%H')


def release_context(env):
    version = env['DESKTOP_VERSION']
    version_key(version)
    identity = build_identity(env)
    if identity['appVersion'] != version or identity['tag'] != version or identity['upstreamCommit'] != env['UPSTREAM_SHA']:
        raise ValueError('Tagged build identity differs from publication inputs')
    sha = env['GITHUB_SHA']
    upstream_sha = env['UPSTREAM_SHA']
    if not all(re.fullmatch(r'[a-f0-9]{40}', value) for value in [sha, upstream_sha]):
        raise ValueError('Both source commits must be full SHA values')
    run_id, attempt = env['GITHUB_RUN_ID'], env['GITHUB_RUN_ATTEMPT']
    if not all(re.fullmatch(r'[1-9]\d*', value) for value in [run_id, attempt]):
        raise ValueError('Invalid workflow run identity')
    release = env.get('RELEASE') == 'true'
    channel = 'beta' if '-beta.' in version else 'stable'
    # 上传目录按时间组织(sensteed-agent/yymmddhh/...)以便浏览;第二层保留
    # 版本与 run 标识,避免同小时多次发布互相覆盖。
    return dict(version=version, appVersion=identity['appVersion'], tag=identity['tag'],
                harnessVersion=identity['harnessVersion'], product='hozonauto-agent',
                releaseGeneration='harness-v1', channel=channel, release=release, commit=sha,
                upstreamCommit=upstream_sha, runId=run_id, runAttempt=attempt,
                prefix=f"sensteed-agent/{upload_stamp(version)}/{version}-{run_id}-{attempt}")



def build_identity(env):
    """Reuse the exact tagged-main packaging gate; do not trust freely set CI version fields."""
    root = Path(__file__).resolve().parents[2]
    script = "import {assertPackagingRelease} from './scripts/release-contract.mjs'; process.stdout.write(JSON.stringify(assertPackagingRelease()))"
    try:
        checked = subprocess.run(['node', '--input-type=module', '-e', script], cwd=root,
                                 check=True, capture_output=True, text=True, timeout=30)
        identity = json.loads(checked.stdout)
        head = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=root, check=True,
                              capture_output=True, text=True, timeout=10).stdout.strip()
        if head != env['GITHUB_SHA']:
            raise ValueError('wrong commit')
        return dict(appVersion=identity['version'], tag=identity['version'],
                    harnessVersion=identity['source']['sourceVersion'], upstreamCommit=identity['source']['commit'])
    except Exception:
        raise ValueError('Publication requires the verified exact tagged build') from None


def sign_manifest(body, config, required=False):
    """Node's built-in Ed25519 signs exact bytes; keys travel over stdin, never argv or disk."""
    pem = config.get('DESKTOP_RELEASE_MANIFEST_SIGNING_KEY_PEM', '')
    key_id = config.get('DESKTOP_RELEASE_MANIFEST_SIGNING_KEY_ID', '')
    if not pem and not key_id and not required:
        return None
    if not pem or not re.fullmatch(r'[A-Za-z0-9._-]{1,100}', key_id):
        raise ValueError('Desktop manifest signing configuration is required')
    script = """const {createPrivateKey,sign}=require('node:crypto');
const {readFileSync}=require('node:fs');
try { const input=JSON.parse(readFileSync(0,'utf8')); const key=createPrivateKey(input.pem);
if(key.asymmetricKeyType!=='ed25519')process.exit(2);
process.stdout.write(sign(null,Buffer.from(input.body,'base64'),key).toString('base64'));
} catch { process.exit(2) }"""
    try:
        result = subprocess.run(['node', '-e', script], input=json.dumps({
            'pem': pem, 'body': base64.b64encode(body).decode('ascii')}),
            capture_output=True, text=True, timeout=15, check=True)
        signature = result.stdout
        if len(base64.b64decode(signature, validate=True)) != 64:
            raise ValueError('signature length')
    except Exception:
        raise ValueError('Desktop manifest signer is unavailable or invalid') from None
    return dict(algorithm='Ed25519', keyId=key_id, signature=signature)

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
            if path.is_symlink() or not path.is_file() or not 0 < path.stat().st_size <= 4 * 1024 ** 3:
                raise ValueError('Artifact must be a nonempty regular file')
            # electron-builder uses target-specific names for the same x64 architecture.
            architecture = {'.AppImage': '(?:x64|x86_64)', '.deb': '(?:x64|amd64)'}.get(suffix, 'x64')
            tail = r'-arm64\.dmg' if platform == 'macos' else '-' + architecture + re.escape(suffix)
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
            files.append(dict(platform=platform, arch='arm64' if platform == 'macos' else 'x64',
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
        for secret in sorted((value for key, value in env.items() if (key.startswith('TOS_') or key.startswith('DESKTOP_RELEASE_MANIFEST_')) and value),
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
    key = f"sensteed-agent/{upload_stamp(env.get('DESKTOP_VERSION'))}/diagnostics/{run_id}-{attempt}/probe.txt"
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


def immutable_upload_input():
    # tos==2.9.3 upload_file does not expose forbid_overwrite as a keyword.
    # GenericInput is propagated through multipart create AND complete.
    from tos.models2 import GenericInput
    return GenericInput(request_headers={'x-tos-forbid-overwrite': 'true'})


def publish(client, config, context, directory):
    bucket = config['TOS_BUCKET']
    files = inventory(directory, context, config['TOS_PUBLIC_BASE_URL'])
    # Check the signer before touching objects. Never read or write a channel pointer.
    sign_manifest(b'publication-check', config, required=context['release'])
    for item in files:
        print(f"TOS upload: {item['platform']}/{item['name']} ({item['size']} bytes)", flush=True)
        progress = UploadProgress(item)
        client.upload_file(bucket, item['key'], str(directory / item['platform'] / item['name']),
                           task_num=4, enable_checkpoint=False, generic_input=immutable_upload_input(),
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
    # Permanent, credential-free URLs only. Private candidates are read by Models'
    # fixed TOS client, then copied into its immutable public release prefix.
    manifest = {**context, 'formatVersion': 2, 'artifacts': files}
    manifest_key = context['prefix'] + '/manifest.json'
    body = (json.dumps(manifest, indent=2, ensure_ascii=True) + '\n').encode()
    signature = sign_manifest(body, config, required=context['release'])
    print('TOS write: version manifest', flush=True)
    client.put_object(bucket, manifest_key, content=body, content_type='application/json',
                      cache_control='public, max-age=31536000, immutable', forbid_overwrite=True)
    manifest_url = config['TOS_PUBLIC_BASE_URL'].rstrip('/') + '/' + quote(manifest_key, safe='/')
    print(f'TOS manifest download: {manifest_url}', flush=True)
    if signature:
        client.put_object(bucket, context['prefix'] + '/manifest.sig.json',
                          content=(json.dumps(signature, indent=2) + '\n').encode(),
                          content_type='application/json',
                          cache_control='public, max-age=31536000, immutable', forbid_overwrite=True)
    print('CI upload complete; Models validation and explicit channel publication remain required.', flush=True)
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
    summary += ['', '在 Models 桌面发布管理页填写版本与以上永久安装包地址；服务端验证通过后显式发布。',
                'CI 上传不修改更新渠道。没有 manifest 签名的候选不能通过 Models 验证。']
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
