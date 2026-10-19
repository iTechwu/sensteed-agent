/** L0-owned bounded archive parser, extracted from Hub's release scanner. Never writes or executes archive entries. */
import { gunzipSync } from 'node:zlib'
const PLUGIN_LIMITS={compressed:52428800,expanded:209715200,files:5000}
class PluginInputError extends Error { constructor(code:string){super(`Hub archive: ${code}`)} }
function pluginAssert(value:unknown,code:string,..._detail:unknown[]):asserts value {if(!value)throw new PluginInputError(code)}
function validPath(path: string) {
  const parts = path.split('/');
  pluginAssert(
    path.length > 0 &&
      path.length <= 500 &&
      parts.length <= 32 &&
      path === path.normalize('NFC') &&
      parts.every(
        (p) =>
          p &&
          p !== '.' &&
          p !== '..' &&
          !/[\\<>:"|?*\x00-\x1f]/.test(p) &&
          !/[. ]$/.test(p) &&
          !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p),
      ),
    'TAR_PATH_INVALID',
    path,
  );
}
export function readHubPluginArchive(buffer:Buffer):ReadonlyMap<string,Buffer> {
  pluginAssert(buffer.length > 0 && buffer.length <= PLUGIN_LIMITS.compressed, 'TGZ_SIZE_LIMIT');
  let tar: Buffer;
  try {
    tar = gunzipSync(buffer, {
      maxOutputLength: PLUGIN_LIMITS.expanded + (PLUGIN_LIMITS.files + 2) * 1024,
    });
  } catch {
    throw new PluginInputError('GZIP_INVALID_OR_LIMIT');
  }
  const contents = new Map<string, Buffer>();
  const names = new Set<string>(),
    regular = new Set<string>(),
    parents = new Set<string>();
  let offset = 0,
    expandedBytes = 0,
    count = 0,
    ended = false;
  const decode = (b: Buffer) => {
    const end = b.indexOf(0),
      raw = end < 0 ? b : b.subarray(0, end);
    pluginAssert(end < 0 || b.subarray(end).every((v) => v === 0), 'TAR_NUL_ENCODING');
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(raw);
    } catch {
      throw new PluginInputError('TAR_PATH_ENCODING');
    }
  };
  const octal = (b: Buffer) => {
    const s = b.toString('ascii').replace(/\0.*$/, '').trim();
    pluginAssert(/^[0-7]+$/.test(s), 'TAR_NUMBER_INVALID');
    const n = parseInt(s, 8);
    pluginAssert(Number.isSafeInteger(n), 'TAR_NUMBER_INVALID');
    return n;
  };
  while (offset + 512 <= tar.length) {
    const h = tar.subarray(offset, offset + 512);
    offset += 512;
    if (h.every((v) => v === 0)) {
      pluginAssert(
        tar.length - offset >= 512 && tar.subarray(offset).every((v) => v === 0),
        'TAR_TRAILING_DATA',
      );
      ended = true;
      break;
    }
    pluginAssert(++count <= PLUGIN_LIMITS.files, 'TAR_FILE_LIMIT');
    const check = octal(h.subarray(148, 156));
    pluginAssert(
      h.reduce((sum, v, i) => sum + (i >= 148 && i < 156 ? 32 : v), 0) === check,
      'TAR_CHECKSUM',
    );
    const magic = h.subarray(257, 263).toString('ascii');
    pluginAssert(magic === 'ustar\0' || magic === 'ustar ', 'TAR_FORMAT_UNSUPPORTED');
    const type = h[156];
    pluginAssert(type === 0 || type === 48 || type === 53, 'TAR_ENTRY_UNSUPPORTED');
    pluginAssert(
      h.subarray(157, 257).every((v) => v === 0),
      'TAR_LINK_UNSUPPORTED',
    );
    const prefix = decode(h.subarray(345, 500));
    let full = `${prefix ? prefix + '/' : ''}${decode(h.subarray(0, 100))}`;
    const directory = type === 53;
    if (directory && full.endsWith('/')) full = full.slice(0, -1);
    validPath(full);
    pluginAssert(
      full === 'package' ? directory : full.startsWith('package/'),
      'TAR_ROOT_INVALID',
      full,
    );
    const path = full === 'package' ? '' : full.slice(8);
    const folded = path.toLowerCase();
    pluginAssert(!names.has(folded), 'TAR_DUPLICATE_PATH', path);
    names.add(folded);
    const parts = folded.split('/');
    pluginAssert(
      !(!directory && parents.has(folded)) &&
        parts.slice(0, -1).every((_, i) => !regular.has(parts.slice(0, i + 1).join('/'))),
      'TAR_PATH_COLLISION',
      path,
    );
    for (let i = 1; i < parts.length; i++) parents.add(parts.slice(0, i).join('/'));
    if (!directory) regular.add(folded);
    const size = octal(h.subarray(124, 136));
    pluginAssert(!directory || size === 0, 'TAR_DIRECTORY_CONTENT');
    pluginAssert(
      (expandedBytes += size) <= PLUGIN_LIMITS.expanded && offset + size <= tar.length,
      'TAR_EXPANSION_LIMIT',
    );
    if (!directory) {
      pluginAssert(
        !/(?:\.node|\.gyp|\.dll|\.exe|\.dylib|\.so(?:\.\d+)?)$/i.test(path) &&
          !/(?:^|\/)(?:\.npmrc|\.pnpmfile\.cjs|pnpmfile\.cjs)$/.test(path),
        'UNSUPPORTED_NATIVE_OR_CONFIG',
        path,
      );
      contents.set(path, tar.subarray(offset, offset + size));
    }
    const padded = Math.ceil(size / 512) * 512;
    pluginAssert(
      offset + padded <= tar.length &&
        tar.subarray(offset + size, offset + padded).every((v) => v === 0),
      'TAR_PADDING_INVALID',
    );
    offset += padded;
  }
  pluginAssert(ended, 'TAR_TRUNCATED');
  return contents
}
