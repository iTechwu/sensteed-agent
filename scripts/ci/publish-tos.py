"""Publish validated desktop artifacts; write the channel pointer only after all uploads succeed."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sys
from urllib.parse import quote, urlsplit


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
            tail = r'(?:-universal)?\.dmg' if platform == 'macos' else '-x64' + re.escape(suffix)
            if (not re.fullmatch(r'[A-Za-z0-9._ -]+', path.name)
                    or not re.search(r'(?<![0-9.])' + re.escape(context['version']) + tail + '$', path.name)):
                raise ValueError('Artifact filename must contain the exact release version')
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


def read_channel(client, bucket, key):
    try:
        response = client.get_object(bucket, key)
    except Exception as error:
        if getattr(error, 'status_code', None) == 404 and getattr(error, 'code', None) == 'NoSuchKey':
            return None, None
        raise
    return json.loads(response.read()), response.etag


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
        client.upload_file(bucket, item['key'], str(directory / item['platform'] / item['name']),
                           task_num=4, enable_checkpoint=False,
                           content_type='application/octet-stream',
                           cache_control='public, max-age=31536000, immutable',
                           meta={'sha256': item['sha256']})
        head = client.head_object(bucket, item['key'])
        if head.content_length != item['size'] or head.meta.get('sha256') != item['sha256']:
            raise ValueError('Uploaded artifact verification failed for ' + item['platform'])
    manifest = {**context, 'formatVersion': 1, 'artifacts': files}
    body = (json.dumps(manifest, indent=2, ensure_ascii=True) + '\n').encode()
    manifest_key = context['prefix'] + '/manifest.json'
    client.put_object(bucket, manifest_key, content=body, content_type='application/json',
                      cache_control='public, max-age=31536000, immutable', forbid_overwrite=True)
    if context['release']:
        # Compare-and-swap also protects against another workflow or an external publisher.
        condition = {'if_match': etag} if etag else {'forbid_overwrite': True}
        client.put_object(bucket, channel_key, content=body, content_type='application/json',
                          cache_control='no-store', **condition)
    return manifest_key, manifest


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check-config', action='store_true')
    parser.add_argument('--artifacts', type=Path, default=Path('artifacts'))
    args = parser.parse_args()
    config = settings(os.environ, check_signing=args.check_config)
    if args.check_config:
        print('TOS configuration is present; no secret values printed.')
        return
    context = release_context(os.environ)
    import tos
    client = tos.TosClientV2(ak=config['TOS_ACCESS_KEY_ID'], sk=config['TOS_SECRET_ACCESS_KEY'],
                             endpoint=config['TOS_ENDPOINT'], region=config['TOS_REGION'],
                             enable_crc=True, max_retry_count=3)
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
        # SDK exceptions may carry request headers: never dump credentials into CI logs.
        if isinstance(error, (ValueError, KeyError)):
            print(str(error), file=sys.stderr)
        else:
            print(f"TOS publication failed ({type(error).__name__}, status={getattr(error, 'status_code', 'unknown')}).", file=sys.stderr)
        sys.exit(1)
