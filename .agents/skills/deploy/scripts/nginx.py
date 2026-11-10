import base64
import json
import pathlib
import re
import subprocess
import sys


def configure_site(text, config):
    # Select the existing HTTPS server, preserving redirects and unrelated sites.
    masked = re.sub(r'#[^\n]*', lambda match: ' ' * len(match[0]), text)
    blocks = []
    for match in re.finditer(r'\bserver\s*\{', masked):
        depth, end = 1, match.end()
        while end < len(masked) and depth:
            depth += (masked[end] == '{') - (masked[end] == '}')
            end += 1
        block = masked[match.end():end - 1]
        names = re.search(r'\bserver_name\s+([^;]+);', block)
        listening = re.search(
            r'\blisten\s+(?:[0-9.]+:|\[::\]:)?' + str(config['port']) + r'\b[^;]*\bssl\b', block
        )
        if names and config['host'] in names[1].split() and listening:
            blocks.append((match.end(), end - 1))
    if len(blocks) != 1:
        raise ValueError('Expected exactly one existing HTTPS server for the configured hostname and port.')
    start, end = blocks[0]
    block = text[start:end]
    label = re.escape(config['service'])
    begin = '# BEGIN ' + config['service'] + ' routes'
    finish = '# END ' + config['service'] + ' routes'
    pattern = r'(?m)^[ \t]*# BEGIN ' + label + r' routes\n.*?^[ \t]*# END ' + label + r' routes[^\n]*\n?'
    matches = list(re.finditer(pattern, block, re.S))
    if len(matches) > 1 or block.count(begin) != len(matches) or block.count(finish) != len(matches):
        raise ValueError('Invalid managed nginx route markers.')
    if matches:
        block = block[:matches[0].start()] + block[matches[0].end():]
    # Migrate the former include without changing any other includes or files.
    legacy = '/etc/nginx/snippets/' + config['service'] + '.conf'
    block = re.sub(r'(?m)^[ \t]*include\s+' + re.escape(legacy) + r';[ \t]*(?:#[^\n]*)?$\n?', '', block)
    if re.search(r'\blocation\s*=\s*/(?:v1/models/resolve|model-catalog/health)\s*\{', block):
        raise ValueError('Application routes already exist outside the managed block.')
    content = begin + '\n' + config['content'].strip() + '\n' + finish
    rendered = '\n'.join('    ' + line if line else '' for line in content.splitlines()) + '\n'
    # Insert at the end of the selected server, without relying on shifted directive offsets.
    return text[:start] + block.rstrip() + '\n' + rendered + text[end:]


def main():
    config = json.loads(base64.b64decode(sys.argv[1]))
    site = pathlib.Path(config['site'])
    original = site.read_bytes()
    updated = configure_site(original.decode(), config)
    try:
        site.write_text(updated)
        subprocess.run(['nginx', '-t'], check=True)
        subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
    except BaseException:
        site.write_bytes(original)
        raise


if __name__ == '__main__':
    main()
