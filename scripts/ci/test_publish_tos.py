import copy
from concurrent.futures import ThreadPoolExecutor
from contextlib import redirect_stdout
import importlib.util
from io import StringIO
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('publish_tos', Path(__file__).with_name('publish-tos.py'))
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)


class MissingObject(Exception):
    status_code = 404
    code = 'NoSuchKey'


class FakeTos:
    def __init__(self, previous=None, fail_upload=False, corrupt_head=False, conflict=False):
        self.previous = previous
        self.fail_upload = fail_upload
        self.corrupt_head = corrupt_head
        self.conflict = conflict
        self.calls = []
        self.objects = {}

    def get_object(self, bucket, key):
        if self.previous is None:
            raise MissingObject()
        return SimpleNamespace(read=lambda: json.dumps(self.previous).encode(), etag='old-etag')

    def upload_file(self, bucket, key, file_path, **kwargs):
        self.calls.append(('upload', key, kwargs))
        if self.fail_upload:
            raise RuntimeError('network unavailable')
        size = Path(file_path).stat().st_size
        if 'data_transfer_listener' in kwargs:
            kwargs['data_transfer_listener'](size, size, size, SimpleNamespace(name='Data_Transfer_RW'))
            kwargs['upload_event_listener'](
                SimpleNamespace(name='Upload_Event_Upload_Part_Succeed'), None,
                bucket, key, 'upload-id', file_path, None,
                SimpleNamespace(part_number=1, part_size=size))
        self.objects[key] = SimpleNamespace(content_length=Path(file_path).stat().st_size, meta=kwargs['meta'])

    def head_object(self, bucket, key):
        result = copy.deepcopy(self.objects[key])
        if self.corrupt_head:
            result.meta['sha256'] = 'corrupt'
        return result

    def put_object(self, bucket, key, **kwargs):
        self.calls.append(('put', key, kwargs))
        if self.conflict and '/channels/' in key:
            raise RuntimeError('precondition failed')
        self.objects[key] = kwargs


class PublicationTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.env = dict(TOS_ACCESS_KEY_ID='test-id', TOS_SECRET_ACCESS_KEY='test-secret',
                        TOS_REGION='test-region', TOS_ENDPOINT='tos.example.com',
                        TOS_PUBLIC_BASE_URL='https://downloads.example.com',
                        DESKTOP_VERSION='2.0.11-beta.18', GITHUB_SHA='a' * 40, UPSTREAM_SHA='b' * 40,
                        GITHUB_RUN_ID='123', GITHUB_RUN_ATTEMPT='2', RELEASE='false')
        self.config = publisher.settings(self.env)
        self.context = publisher.release_context(self.env)
        for platform, endings in dict(macos=['arm64.dmg'], windows=['x64-Setup.exe', 'x64-Portable.zip'],
                                      linux=['x64.AppImage', 'x64.deb']).items():
            folder = self.root / platform
            folder.mkdir()
            for ending in endings:
                (folder / ('Sensteed-Agent-Beta-2.0.11-beta.18-' + ending)).write_bytes(b'installer payload')

    def test_rejects_oversized_installer_before_hashing_or_uploading(self):
        path = next((self.root / 'macos').iterdir())
        with path.open('wb') as stream:
            stream.truncate(publisher.MAX_ARTIFACT_BYTES + 1)
        client = FakeTos()
        with self.assertRaisesRegex(ValueError, '1 GiB updater size limit'):
            publisher.publish(client, self.config, self.context, self.root)
        self.assertEqual(client.calls, [])

    def test_config_supports_endpoint_hostname_and_requires_secrets(self):
        self.assertEqual(self.config['TOS_ENDPOINT'], 'https://tos.example.com')
        self.assertEqual(self.config['TOS_BUCKET'], 'dofe-public')
        for name, value in [('TOS_SECRET_ACCESS_KEY', ''), ('TOS_ENDPOINT', 'http://example.com'),
                            ('TOS_ENDPOINT', 'https://user:password@example.com'),
                            ('TOS_PUBLIC_BASE_URL', 'https://example.com?token=x'), ('TOS_BUCKET', 'another-bucket')]:
            with self.subTest(name=name, value=value), self.assertRaises(ValueError):
                publisher.settings({**self.env, name: value})

    def test_signed_release_requires_credentials_only_in_preflight(self):
        env = {**self.env, 'RELEASE': 'true'}
        with self.assertRaisesRegex(ValueError, 'MAC_CERT_P12_BASE64'):
            publisher.settings(env, check_signing=True)
        publisher.settings(env)

    def test_candidate_uploads_every_platform_before_manifest_and_never_advances_channel(self):
        client = FakeTos()
        key, manifest = publisher.publish(client, self.config, self.context, self.root)
        self.assertEqual(len(manifest['artifacts']), 5)
        self.assertTrue(key.startswith('sensteed-agent/candidates/' + 'a' * 40 + '/123-2/'))
        self.assertEqual([call[0] for call in client.calls], ['upload'] * 5 + ['put'])
        self.assertTrue(client.calls[-1][2]['forbid_overwrite'])
        self.assertTrue(all(item['signing'] == 'unsigned' for item in manifest['artifacts']))
        self.assertEqual(manifest['upstreamCommit'], 'b' * 40)

    def test_publishes_actual_electron_builder_filenames_from_ci(self):
        macos = next((self.root / 'macos').iterdir())
        macos.rename(macos.with_name('Sensteed-Agent Beta-2.0.11-beta.18-arm64.dmg'))
        for suffix, architecture in [('.AppImage', 'x86_64'), ('.deb', 'amd64')]:
            path = next((self.root / 'linux').glob('*' + suffix))
            path.rename(path.with_name(path.name.replace('-x64', '-' + architecture)))
        client = FakeTos()
        _, manifest = publisher.publish(client, self.config, self.context, self.root)
        linux = [item for item in manifest['artifacts'] if item['platform'] == 'linux']
        self.assertEqual([item['arch'] for item in linux], ['x64', 'x64'])
        self.assertEqual([item['name'].split('-')[-1] for item in linux],
                         ['x86_64.AppImage', 'amd64.deb'])
        self.assertIn('Sensteed-Agent%20Beta-', manifest['artifacts'][0]['url'])
        self.assertEqual([call[0] for call in client.calls], ['upload'] * 5 + ['put'])

    def test_mac_artifact_requires_arm64_suffix(self):
        target = next((self.root / 'macos').iterdir())
        original = target.name
        for suffix in ['universal.dmg', 'x64.dmg', '.dmg']:
            renamed = target.with_name(original.rsplit('-', 1)[0] + '-' + suffix)
            target.rename(renamed)
            client = FakeTos()
            with self.subTest(suffix=suffix), self.assertRaises(ValueError):
                publisher.publish(client, self.config, self.context, self.root)
            self.assertEqual([], client.calls)
            renamed.rename(target)

    def test_candidates_and_releases_print_all_download_urls_after_verification(self):
        macos = next((self.root / 'macos').iterdir())
        macos.rename(macos.with_name(macos.name.replace('Sensteed-Agent-Beta', 'Sensteed-Agent Beta')))
        for release in ['false', 'true']:
            with self.subTest(release=release):
                context = publisher.release_context({**self.env, 'RELEASE': release})
                output = StringIO()
                with redirect_stdout(output):
                    key, manifest = publisher.publish(FakeTos(), self.config, context, self.root)
                logs = output.getvalue()
                self.assertEqual(logs.count('TOS download:'), 5)
                for item in manifest['artifacts']:
                    expected = f"TOS download: {item['platform']}/{item['name']} -> {item['url']}"
                    self.assertIn(expected, logs)
                    self.assertLess(logs.index(f"TOS verify: {item['platform']}/{item['name']}"),
                                    logs.index(expected))
                self.assertIn('Sensteed-Agent%20Beta-', logs)
                self.assertIn('TOS manifest download: ' + self.config['TOS_PUBLIC_BASE_URL'] + '/' + key, logs)

    def test_failed_uploads_and_verification_do_not_print_download_urls(self):
        for options in [dict(fail_upload=True), dict(corrupt_head=True)]:
            with self.subTest(options=options):
                output = StringIO()
                with redirect_stdout(output), self.assertRaises((ValueError, RuntimeError)):
                    publisher.publish(FakeTos(**options), self.config, self.context, self.root)
                self.assertNotIn('TOS download:', output.getvalue())
                self.assertNotIn('TOS manifest download:', output.getvalue())

    def test_linux_aliases_do_not_allow_wrong_versions_or_other_architectures(self):
        for suffix, architecture in [('.AppImage', 'x86_64'), ('.deb', 'amd64')]:
            path = next((self.root / 'linux').glob('*' + suffix))
            actual_name = path.name.replace('-x64', '-' + architecture)
            rejected = [actual_name.replace('beta.18', 'beta.180'),
                        actual_name.replace(architecture, 'arm64'),
                        actual_name.replace(architecture, 'amd64' if architecture == 'x86_64' else 'x86_64')]
            for name in rejected:
                client = FakeTos()
                renamed = path.with_name(name)
                path.rename(renamed)
                with self.subTest(name=name), self.assertRaises(ValueError) as error:
                    publisher.publish(client, self.config, self.context, self.root)
                self.assertIn(name, str(error.exception))
                self.assertIn('linux', str(error.exception))
                self.assertIn('2.0.11-beta.18', str(error.exception))
                self.assertEqual(client.calls, [])
                renamed.rename(path)

    def test_upload_or_verification_failure_never_publishes_manifest_or_channel(self):
        self.context['release'] = True
        for options in [dict(fail_upload=True), dict(corrupt_head=True)]:
            client = FakeTos(**options)
            with self.subTest(options=options), self.assertRaises((ValueError, RuntimeError)):
                publisher.publish(client, self.config, self.context, self.root)
            self.assertFalse(any(call[0] == 'put' for call in client.calls))

    def test_release_advances_channel_last_using_compare_and_swap(self):
        self.context = publisher.release_context({**self.env, 'RELEASE': 'true'})
        for previous in [None, {'version': '2.0.11-beta.9'}]:
            client = FakeTos(previous=previous)
            key, manifest = publisher.publish(client, self.config, self.context, self.root)
            self.assertIn('/releases/beta/2.0.11-beta.18/', key)
            self.assertEqual(client.calls[-1][1], 'sensteed-agent/channels/beta.json')
            self.assertEqual(client.calls[-2][1], key)
            self.assertEqual(manifest['artifacts'][0]['signing'], 'signed-notarized')
            condition = client.calls[-1][2]
            self.assertEqual(condition['cache_control'], 'no-store')
            if previous:
                self.assertEqual(condition['if_match'], 'old-etag')
            else:
                self.assertTrue(condition['forbid_overwrite'])

    def test_equal_or_newer_channel_prevents_uploads(self):
        self.context['release'] = True
        for version in ['2.0.11-beta.18', '2.0.11-beta.19', '2.0.12-beta.1']:
            client = FakeTos(previous={'version': version})
            with self.assertRaisesRegex(ValueError, 'newer'):
                publisher.publish(client, self.config, self.context, self.root)
            self.assertEqual(client.calls, [])

    def test_channel_race_is_reported_without_overwriting_existing_pointer(self):
        self.context['release'] = True
        client = FakeTos(previous={'version': '2.0.11-beta.17'}, conflict=True)
        with self.assertRaisesRegex(RuntimeError, 'precondition'):
            publisher.publish(client, self.config, self.context, self.root)
        self.assertNotIn('sensteed-agent/channels/beta.json', client.objects)

    def test_missing_platform_extra_file_empty_file_and_version_mismatch_fail_before_upload(self):
        target = next((self.root / 'linux').iterdir())
        original = target.read_bytes()
        for mode in ['missing', 'empty', 'extra', 'version']:
            client = FakeTos()
            extra = self.root / 'linux' / 'debug.log'
            renamed = target.with_name(target.name.replace('beta.18', 'beta.180'))
            if mode == 'missing':
                target.unlink()
            elif mode == 'empty':
                target.write_bytes(b'')
            elif mode == 'extra':
                extra.write_text('log')
            else:
                target.rename(renamed)
            with self.subTest(mode=mode), self.assertRaises(ValueError):
                publisher.publish(client, self.config, self.context, self.root)
            self.assertEqual(client.calls, [])
            extra.unlink(missing_ok=True)
            renamed.unlink(missing_ok=True)
            target.write_bytes(original)

    def test_permission_error_reading_channel_is_not_treated_as_empty_channel(self):
        self.context['release'] = True
        client = FakeTos()
        def denied(*args):
            raise PermissionError('denied')
        client.get_object = denied
        with self.assertRaises(PermissionError):
            publisher.publish(client, self.config, self.context, self.root)
        self.assertEqual(client.calls, [])

    def test_stable_version_cannot_publish_beta_files_or_wrong_architecture(self):
        for version in ['2.0.11', '2.0.11-beta.18']:
            client = FakeTos()
            self.context['version'] = version
            target = next((self.root / 'windows').iterdir())
            renamed = target.with_name(target.name.replace('-x64-', '-arm64-'))
            target.rename(renamed)
            with self.subTest(version=version), self.assertRaises(ValueError):
                publisher.publish(client, self.config, self.context, self.root)
            self.assertEqual(client.calls, [])
            renamed.rename(target)

    def test_probe_exercises_multipart_and_head_without_releasing_artifacts(self):
        client = FakeTos()
        publisher.probe(client, self.config, self.env)
        self.assertEqual(len(client.calls), 1)
        self.assertEqual(client.calls[0][1], 'sensteed-agent/diagnostics/123-2/probe.txt')
        with self.assertRaisesRegex(ValueError, 'verification'):
            publisher.probe(FakeTos(corrupt_head=True), self.config, self.env)

    def test_sdk_diagnostic_preserves_error_code_and_request_id_without_credentials(self):
        error = RuntimeError('request headers must never be printed')
        error.status_code = 400
        error.code = 'AuthorizationQueryParametersError'
        error.request_id = 'request-123'
        error.message = 'invalid region test-region; test-secret; https://example.com/?signature=private'
        error.header = {'Authorization': 'private-header'}
        error.request_url = 'private-url'
        output = publisher.diagnostic(error, self.env)
        self.assertIn('AuthorizationQueryParametersError', output)
        self.assertIn('request-123', output)
        for secret in ['test-region', 'test-secret', 'private', 'request headers']:
            self.assertNotIn(secret, output)

    def test_s3_and_bucket_endpoints_resolve_to_native_service_for_same_region(self):
        for endpoint in ['tos-s3-cn-beijing.volces.com', 'https://tos-s3-cn-beijing.volces.com/',
                         'https://dofe-public.tos-s3-cn-beijing.volces.com',
                         'https://dofe-public.tos-cn-beijing.volces.com']:
            with self.subTest(endpoint=endpoint):
                config = publisher.settings({**self.env, 'TOS_ENDPOINT': endpoint, 'TOS_REGION': 'cn-beijing'})
                self.assertEqual(config['TOS_ENDPOINT'], 'https://tos-cn-beijing.volces.com')
                self.assertEqual(config['TOS_PUBLIC_BASE_URL'], self.env['TOS_PUBLIC_BASE_URL'])
        with self.assertRaisesRegex(ValueError, 'region'):
            publisher.settings({**self.env, 'TOS_ENDPOINT': 'tos-s3-cn-beijing.volces.com'})

    def test_xml_service_error_excludes_echoed_authorization(self):
        error = RuntimeError()
        error.status_code = 400
        error.message = ('<Error><Code>InvalidArgument</Code><RequestId>req-123</RequestId>'
                         '<Message>Unsupported Authorization Type</Message><EC>0002-00000002</EC>'
                         '<ArgumentName>Authorization</ArgumentName><ArgumentValue>'
                         'TOS4-HMAC-SHA256 Credential=test-id, Signature=sensitive-signature'
                         '</ArgumentValue></Error>')
        output = publisher.diagnostic(error, self.env)
        for expected in ['InvalidArgument', 'req-123', 'Unsupported Authorization Type', '0002-00000002']:
            self.assertIn(expected, output)
        for secret in ['Credential', 'sensitive-signature', 'ArgumentValue', 'test-id']:
            self.assertNotIn(secret, output)

    def test_invalid_source_or_run_identity_is_rejected(self):
        for name, value in [('GITHUB_SHA', 'dev'), ('UPSTREAM_SHA', ''), ('GITHUB_RUN_ID', '../123')]:
            with self.subTest(name=name), self.assertRaises(ValueError):
                publisher.release_context({**self.env, name: value})


class UploadProgressTests(unittest.TestCase):
    def test_transfer_logs_are_throttled_and_include_retry_bytes_and_speed(self):
        output = StringIO()
        with patch.object(publisher, 'monotonic', side_effect=[0, 1, 30, 31, 60]), redirect_stdout(output):
            progress = publisher.UploadProgress(dict(platform='macos', name='installer.dmg', size=100))
            for sent in [10, 50, 75, 150]:
                progress.transfer(sent, 100, 10, None)
        lines = output.getvalue().splitlines()
        self.assertEqual(len(lines), 2)
        self.assertIn('sent=50 bytes (including retries); elapsed=30s; average=', lines[0])
        self.assertIn('sent=150 bytes (including retries); elapsed=60s; average=', lines[1])

    def test_parallel_part_events_report_confirmed_bytes_and_omit_sdk_details(self):
        output = StringIO()
        progress = publisher.UploadProgress(dict(platform='macos', name='installer.dmg', size=100))
        def part(number):
            progress.event(SimpleNamespace(name='Upload_Event_Upload_Part_Succeed'), None,
                           'secret-bucket', 'secret-key', 'secret-upload-id', 'secret-path', 'secret-checkpoint',
                           SimpleNamespace(part_number=number, part_size=25))
        with redirect_stdout(output):
            with ThreadPoolExecutor(max_workers=4) as pool:
                list(pool.map(part, range(1, 5)))
            progress.event(SimpleNamespace(name='Upload_Event_Complete_Multipart_Upload_Failed'),
                           RuntimeError('secret-request-headers'), None, None, None, None, None, None)
        self.assertEqual(progress.confirmed, 100)
        self.assertIn('confirmed=100/100 bytes (100.0%)', output.getvalue())
        self.assertIn('Upload_Event_Complete_Multipart_Upload_Failed', output.getvalue())
        self.assertNotIn('secret', output.getvalue())


if __name__ == '__main__':
    unittest.main()
