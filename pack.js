// prpack-demo — runs entirely in the browser. Calls the public GitHub REST API.
// Mirrors the prpack CLI output format: header, commits, file list, per-file diff + post-change content.

const STATUS = document.getElementById('status');
const OUTPUT = document.getElementById('output');
const OUTPUT_PRE = document.getElementById('output-pre');
const STATS = document.getElementById('stats');
const URL_INPUT = document.getElementById('url');
const PACK_BTN = document.getElementById('pack');
const COPY_BTN = document.getElementById('copy');
const DOWNLOAD_BTN = document.getElementById('download');

const TEST_PATTERNS = [
  /(^|\/)test\//,
  /(^|\/)tests\//,
  /(^|\/)__tests__\//,
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
  /_test\.go$/,
  /_test\.py$/,
  /_spec\.rb$/,
];

const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.tif', '.tiff',
  '.pdf', '.zip', '.tar', '.gz', '.bz2', '.xz', '.7z', '.rar',
  '.mp3', '.mp4', '.mov', '.avi', '.webm', '.wav', '.flac',
  '.exe', '.dll', '.so', '.dylib', '.o', '.a',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.lock',
]);

const STATUS_LABEL = {
  added: 'added',
  modified: 'modified',
  removed: 'deleted',
  renamed: 'renamed',
  copied: 'copied',
  changed: 'modified',
  unchanged: 'unchanged',
};

const MAX_BYTES = 200000;

let lastOutput = '';
let lastFilename = 'prpack-context.md';

function setStatus(msg, isError = false) {
  if (!msg) {
    STATUS.classList.remove('show', 'error');
    STATUS.textContent = '';
    return;
  }
  STATUS.textContent = msg;
  STATUS.classList.add('show');
  STATUS.classList.toggle('error', isError);
}

function parsePrUrl(url) {
  const m = url.trim().match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!m) return null;
  return { owner: m[1], repo: m[2], number: parseInt(m[3], 10) };
}

async function gh(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) {
    if (res.status === 403) {
      const remaining = res.headers.get('x-ratelimit-remaining');
      throw new Error(
        `GitHub API rate limit hit (remaining: ${remaining ?? '0'}). The unauthenticated limit is 60 requests/hour per IP. Wait an hour or try the CLI: npx github:Lucas2944/prpack.`,
      );
    }
    if (res.status === 404) {
      throw new Error('Not found. Is the PR URL correct and the repo public?');
    }
    throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function ghPaginate(path, max = 300) {
  const all = [];
  let page = 1;
  while (all.length < max) {
    const sep = path.includes('?') ? '&' : '?';
    const batch = await gh(`${path}${sep}per_page=100&page=${page}`);
    all.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  return all;
}

function shortSha(sha) {
  return (sha || '').slice(0, 7);
}

function languageHint(path) {
  const ext = (path.split('.').pop() || '').toLowerCase();
  const map = {
    js: 'js', mjs: 'js', cjs: 'js',
    ts: 'ts', tsx: 'tsx', jsx: 'jsx',
    py: 'python', rb: 'ruby', go: 'go', rs: 'rust',
    java: 'java', kt: 'kotlin', swift: 'swift',
    c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', hpp: 'cpp',
    cs: 'csharp', php: 'php', sh: 'bash', bash: 'bash', zsh: 'bash',
    yml: 'yaml', yaml: 'yaml', json: 'json', toml: 'toml',
    md: 'markdown', html: 'html', css: 'css', scss: 'scss',
    sql: 'sql', dockerfile: 'dockerfile',
  };
  return map[ext] || '';
}

function pickFence(content) {
  let max = 2;
  const re = /`{3,}/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    if (m[0].length > max) max = m[0].length;
  }
  return '`'.repeat(max + 1);
}

function isTestFile(path) {
  return TEST_PATTERNS.some((re) => re.test(path));
}

function isBinaryByExt(path) {
  const idx = path.lastIndexOf('.');
  if (idx < 0) return false;
  return BINARY_EXT.has(path.slice(idx).toLowerCase());
}

function b64decode(s) {
  // GitHub Contents API returns base64 with newlines
  const cleaned = (s || '').replace(/\s+/g, '');
  try {
    return decodeURIComponent(
      atob(cleaned)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join(''),
    );
  } catch {
    return null;
  }
}

async function fetchFileContent(owner, repo, path, ref) {
  try {
    const data = await gh(
      `/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}?ref=${encodeURIComponent(ref)}`,
    );
    if (data.encoding !== 'base64') return null;
    if (typeof data.size === 'number' && data.size > MAX_BYTES) return { tooBig: true, size: data.size };
    const text = b64decode(data.content || '');
    if (text == null) return null;
    return { text };
  } catch {
    return null;
  }
}

function buildHeader({ pr, files, commits }) {
  const lines = [];
  lines.push('# Pull Request Context\n');
  lines.push(`**Repo:** \`${pr.base.repo.full_name}\`  `);
  lines.push(`**PR #${pr.number}:** ${pr.title}  `);
  lines.push(`**Branch:** \`${pr.head.ref}\`  `);
  lines.push(`**Base:** \`${pr.base.ref}\` → **Head:** \`${pr.head.ref}\`  `);
  lines.push(`**Merge-base / base SHA:** \`${shortSha(pr.base.sha)}\`  `);
  lines.push(`**Commits:** ${commits.length}  `);
  lines.push(`**Files changed:** ${files.length}\n`);
  lines.push(
    '> Generated with [prpack](https://github.com/Lucas2944/prpack) (browser demo). ' +
      'Ask your model to "review the diff using the full file contents below as context."',
  );
  lines.push('');
  return lines.join('\n');
}

async function pack(prUrl, opts) {
  const parsed = parsePrUrl(prUrl);
  if (!parsed) throw new Error('Not a valid GitHub PR URL. Expected: https://github.com/owner/repo/pull/123');
  const { owner, repo, number } = parsed;

  setStatus('Fetching PR…');
  const pr = await gh(`/repos/${owner}/${repo}/pulls/${number}`);

  setStatus('Fetching commits…');
  const commits = await ghPaginate(`/repos/${owner}/${repo}/pulls/${number}/commits`, 250);

  setStatus('Fetching file list…');
  const filesRaw = await ghPaginate(`/repos/${owner}/${repo}/pulls/${number}/files`, 300);

  // Filter binary + opt excludes
  let files = filesRaw.filter((f) => !isBinaryByExt(f.filename));
  const out = [];
  out.push(buildHeader({ pr, files, commits }));

  if (commits.length > 0) {
    out.push('## Commits\n');
    for (const c of commits) {
      const sha = shortSha(c.sha);
      const date = (c.commit.author?.date || '').slice(0, 10);
      const author = c.commit.author?.name || c.author?.login || '?';
      const subject = (c.commit.message || '').split('\n')[0];
      out.push(`- \`${sha}\` ${date} — ${subject}${author ? ` _(${author})_` : ''}`);
    }
    out.push('');
  }

  out.push('## Files changed\n');
  for (const f of files) {
    const tag = STATUS_LABEL[f.status] || f.status;
    const path = f.previous_filename ? `${f.previous_filename} → ${f.filename}` : f.filename;
    out.push(`- \`${path}\` _(${tag})_`);
  }
  out.push('');

  // Optionally pull tests (we don't have a local repo, so we approximate: include any test-pathed files already changed)
  // For pure browser, we don't try to add adjacent non-changed test files.

  const includeContent = !opts.noContent;
  const headRef = pr.head.sha;

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    setStatus(`Fetching files (${i + 1}/${files.length})…`);
    const heading = f.previous_filename ? `${f.previous_filename} → ${f.filename}` : f.filename;
    const tag = STATUS_LABEL[f.status] || f.status;
    out.push(`---\n## \`${heading}\` _(${tag})_\n`);

    if (f.patch && f.status !== 'removed') {
      out.push('### Diff\n');
      out.push('```diff');
      out.push(f.patch.replace(/\s+$/, ''));
      out.push('```\n');
    } else if (f.status === 'removed') {
      out.push('_File deleted in this PR._\n');
    } else if (!f.patch) {
      out.push('_(diff omitted — likely binary or too large)_\n');
    }

    if (includeContent && f.status !== 'removed') {
      const result = await fetchFileContent(owner, repo, f.filename, headRef);
      if (result && result.text != null) {
        const fence = pickFence(result.text);
        const lang = languageHint(f.filename);
        out.push(`### Full content (post-change)\n`);
        out.push(`${fence}${lang}`);
        out.push(result.text.replace(/\s+$/, ''));
        out.push(fence);
        out.push('');
      } else if (result && result.tooBig) {
        out.push(`_Skipped: ${result.size} bytes exceeds 200 KB limit (configurable in the CLI)._\n`);
      }
    }
  }

  return { markdown: out.join('\n'), files, commits, pr };
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

async function run() {
  const url = URL_INPUT.value.trim();
  if (!url) { setStatus('Paste a public GitHub PR URL first.', true); return; }

  PACK_BTN.disabled = true;
  OUTPUT.classList.remove('show');
  OUTPUT_PRE.textContent = '';
  setStatus('Working…');

  try {
    const opts = {
      includeTests: document.getElementById('opt-include-tests').checked,
      noContent: document.getElementById('opt-no-content').checked,
    };
    const { markdown, files, commits, pr } = await pack(url, opts);
    lastOutput = markdown;
    lastFilename = `prpack-${pr.base.repo.name}-${pr.number}.md`;

    OUTPUT_PRE.textContent = markdown;
    const bytes = new Blob([markdown]).size;
    const tokens = Math.round(bytes / 4);
    STATS.innerHTML = `<b>${files.length}</b> files · <b>${commits.length}</b> commits · <b>${formatBytes(bytes)}</b> · ~<b>${tokens.toLocaleString()}</b> tokens`;
    OUTPUT.classList.add('show');
    setStatus('');
  } catch (err) {
    setStatus(err.message || String(err), true);
  } finally {
    PACK_BTN.disabled = false;
  }
}

PACK_BTN.addEventListener('click', run);
URL_INPUT.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') run();
});

COPY_BTN.addEventListener('click', async () => {
  if (!lastOutput) return;
  await navigator.clipboard.writeText(lastOutput);
  COPY_BTN.textContent = 'Copied!';
  setTimeout(() => (COPY_BTN.textContent = 'Copy'), 1500);
});

DOWNLOAD_BTN.addEventListener('click', () => {
  if (!lastOutput) return;
  const blob = new Blob([lastOutput], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = lastFilename;
  a.click();
  URL.revokeObjectURL(a.href);
});

document.querySelectorAll('.examples a[data-url]').forEach((a) => {
  a.addEventListener('click', (e) => {
    e.preventDefault();
    URL_INPUT.value = a.dataset.url;
    run();
  });
});

// If a ?pr= query param is present, auto-fill and run
const params = new URLSearchParams(location.search);
const seedUrl = params.get('pr') || params.get('url');
if (seedUrl) {
  URL_INPUT.value = seedUrl;
  run();
}
