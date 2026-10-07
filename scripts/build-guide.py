"""Build offline, escaped document/source previews for docs/index.html."""
import html
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FILES = [
    'README.md', 'docs/results/phase7-security-hardening.md',
    'docs/results/phase7-security-audit.md', 'docs/results/phase7-ui-accessibility-review.md',
    'docs/results/phase7-integrated-validation.md', 'docs/results/phase5-temperature-forecast.md',
    'docs/instructions/phase7-security-hardening.md', '.project/plan.md', 'DESIGN.md',
    'docs/instructions/phase7-agent-answers.md', 'docs/results/phase7-agent-answers.md',
    'backend/app/main.py', 'backend/app/security.py', 'backend/app/replay/producer.py',
    'backend/app/domain/state.py', 'backend/app/streaming/consumer.py',
    'backend/app/agent/tools.py', 'backend/app/agent/service.py', 'backend/app/agent/traces.py',
    'backend/app/agent/answers.py',
    'backend/app/simulator/service.py', 'backend/app/forecast/train.py', 'backend/app/forecast/service.py',
    'frontend/src/telemetry.ts', 'frontend/src/App.tsx', 'frontend/src/AgentPanel.tsx',
    'frontend/src/SimulatorPanel.tsx', 'frontend/src/ForecastPanel.tsx',
]


def inline(text, source):
    escaped = html.escape(text)
    tokens = []

    def keep(value):
        tokens.append(value)
        return f'\x00{len(tokens) - 1}\x00'

    escaped = re.sub(r'`([^`]+)`', lambda m: keep('<code>' + m[1] + '</code>'), escaped)

    def link(match):
        image, label, target = match.groups()
        target = html.unescape(target).split('#')[0]
        if target.startswith(('https://', 'http://')):
            return keep(f'<a href="{html.escape(target, quote=True)}" target="_blank" rel="noreferrer">{label} (새 탭)</a>')
        path = (ROOT / source).parent / target
        try:
            relative = path.resolve().relative_to(ROOT).as_posix()
        except ValueError:
            return label
        if image and relative.startswith('docs/images/') and path.is_file():
            return keep(f'<img src="{html.escape(relative[5:], quote=True)}" alt="{label}" loading="lazy">')
        if relative in FILES:
            return keep(f'<button data-doc="{html.escape(relative, quote=True)}">{label}</button>')
        return label

    escaped = re.sub(r'(!?)\[([^\]]+)\]\(([^)]+)\)', link, escaped)
    escaped = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', escaped)
    escaped = re.sub(r'\x00(\d+)\x00', lambda m: tokens[int(m[1])], escaped)
    return escaped


def markdown(text, source):
    lines = text.splitlines()
    output, paragraph = [], []
    i = 0

    def flush():
        if paragraph:
            output.append('<p>' + inline(' '.join(paragraph), source) + '</p>')
            paragraph.clear()

    while i < len(lines):
        line = lines[i]
        if line.startswith('```'):
            flush()
            code = []
            i += 1
            while i < len(lines) and not lines[i].startswith('```'):
                code.append(lines[i])
                i += 1
            output.append('<pre><code>' + html.escape('\n'.join(code)) + '</code></pre>')
        elif line.startswith('|') and i + 1 < len(lines) and re.match(r'^\|[\s:|\-]+\|?$', lines[i + 1]):
            flush()
            cells = lambda row: row.strip().strip('|').split('|')
            output.append('<table><thead><tr>' + ''.join('<th scope="col">' + inline(cell.strip(), source) + '</th>' for cell in cells(line)) + '</tr></thead><tbody>')
            i += 2
            while i < len(lines) and lines[i].startswith('|'):
                output.append('<tr>' + ''.join('<td>' + inline(cell.strip(), source) + '</td>' for cell in cells(lines[i])) + '</tr>')
                i += 1
            output.append('</tbody></table>')
            continue
        elif heading := re.match(r'^(#{1,6})\s+(.*)', line):
            flush()
            level = min(len(heading[1]), 3)
            output.append(f'<h{level}>' + inline(heading[2], source) + f'</h{level}>')
        elif re.match(r'^\s*(?:[-*]|\d+\.)\s+', line):
            flush()
            ordered = bool(re.match(r'^\d+\.', line))
            tag = 'ol' if ordered else 'ul'
            output.append(f'<{tag}>')
            while i < len(lines) and re.match(r'^\s*(?:[-*]|\d+\.)\s+', lines[i]):
                content = re.sub(r'^\s*(?:[-*]|\d+\.)\s+', '', lines[i])
                output.append('<li>' + inline(content, source) + '</li>')
                i += 1
            output.append(f'</{tag}>')
            continue
        elif not line.strip() or line.strip() == '---':
            flush()
        else:
            paragraph.append(line)
        i += 1
    flush()
    return '\n'.join(output)


def main():
    content = {}
    for name in FILES:
        text = (ROOT / name).read_text(encoding='utf-8')
        title = text.splitlines()[0].lstrip('# ') if name.endswith('.md') else Path(name).name
        rendered = markdown(text, name) if name.endswith('.md') else '<pre><code>' + html.escape(text) + '</code></pre>'
        content[name] = {'title': title, 'html': rendered}
    payload = json.dumps(content, ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c')
    target = ROOT / 'docs/index.html'
    page, count = re.subn(r'<script id="guide-content">.*?</script>',
                          lambda _: '<script id="guide-content">\nwindow.guideContent=' + payload + ';\n</script>',
                          target.read_text(encoding='utf-8'), flags=re.DOTALL)
    if count != 1:
        raise ValueError('Expected exactly one guide-content block in docs/index.html')
    target.write_text(page, encoding='utf-8')
    print(f'Built {len(content)} offline document/source previews')


if __name__ == '__main__':
    main()
