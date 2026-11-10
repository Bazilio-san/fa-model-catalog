import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

test('Nginx routes stay in the selected site, update without duplicates, and migrate the old include', () => {
  const script = `
import importlib.util, sys
spec = importlib.util.spec_from_file_location('catalog_nginx', sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
config = {'host': 'catalog.example.com', 'port': 443, 'service': 'fa-model-catalog',
          'content': 'location = /model-catalog/health { proxy_pass http://127.0.0.1:3000/health; }'}
redirect = 'server { listen 80; server_name catalog.example.com; return 301 https://$host$request_uri; }'
site = redirect + '\\nserver {\\n listen 443 ssl;\\n server_name catalog.example.com;\\n location / { return 404; }\\n}\\n'
updated = module.configure_site(site, config)
assert updated.startswith(redirect)
assert 'location / { return 404; }' in updated
assert 'include ' not in updated
assert updated.count('location = /model-catalog/health') == 1
assert module.configure_site(updated, config) == updated
config['content'] = config['content'].replace('3000', '4000')
revised = module.configure_site(updated, config)
assert ':4000/health' in revised and ':3000/health' not in revised
legacy = site.replace(' location /', ' include /etc/nginx/snippets/fa-model-catalog.conf;\\n location /')
assert 'include /etc/nginx/snippets/fa-model-catalog.conf;' not in module.configure_site(legacy, config)
for invalid in [redirect, site + site, updated.replace('# END fa-model-catalog routes', '# broken'),
                site.replace(' location /', ' location = /v1/models/resolve {}\\n location /')]:
    try:
        module.configure_site(invalid, config)
        raise AssertionError('Conflicting or invalid site accepted')
    except ValueError:
        pass
`;
  const result = spawnSync('python', ['-B', '-c', script, resolve('.agents/skills/deploy/scripts/nginx.py')], {
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
});
