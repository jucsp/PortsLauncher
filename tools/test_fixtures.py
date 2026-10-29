import unittest
import json
import re
from pathlib import Path
from collections import Counter

BASE_DIR = Path(__file__).resolve().parent.parent
GW_DIR = BASE_DIR / 'fixtures' / 'gamewave'
QUIVER_DIR = BASE_DIR / 'fixtures' / 'quiver'


class TestGameWaveFixtures(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        catalog_path = GW_DIR / 'catalog-2026.10.24.3.json'
        if not catalog_path.exists():
            catalog_path = GW_DIR / 'catalog.json'
        with open(catalog_path, 'r', encoding='utf-8') as f:
            cls.cat24 = json.load(f)
        cls.apps24 = cls.cat24.get('apps', [])
        cls.enabled24 = [a for a in cls.apps24 if a.get('enabled') is True]
        cls.disabled24 = [a for a in cls.apps24 if not a.get('enabled')]

        cat22_path = GW_DIR / 'catalog-2026.10.22.1.json'
        if cat22_path.exists():
            with open(cat22_path, 'r', encoding='utf-8') as f:
                cls.cat22 = json.load(f)
            cls.apps22 = cls.cat22.get('apps', [])
        else:
            cls.cat22 = None
            cls.apps22 = []

    def test_catalog_2026_10_24_total_and_status(self):
        self.assertEqual(len(self.apps24), 1173)
        self.assertEqual(len(self.enabled24), 1010)
        self.assertEqual(len(self.disabled24), 163)

    def test_catalog_2026_10_24_source_types(self):
        counts = Counter(a.get('sourceType') for a in self.apps24)
        self.assertEqual(counts.get('github'), 938)
        self.assertEqual(counts.get('external'), 216)
        self.assertEqual(counts.get('info'), 16)
        self.assertEqual(counts.get('local'), 1)
        self.assertEqual(counts.get('community'), 1)
        self.assertEqual(counts.get('official-website'), 1)

    def test_catalog_2026_10_24_github_enabled_and_repos(self):
        gh_enabled = [a for a in self.enabled24 if a.get('sourceType') == 'github']
        self.assertEqual(len(gh_enabled), 782)
        repo_pattern = re.compile(r'^[^/]+/[^/]+$')
        for a in gh_enabled:
            repo = a.get('repository')
            self.assertIsNotNone(repo, f'Ficha {a.get("id")} sin repository')
            self.assertTrue(bool(repo_pattern.match(repo)), f'Formato inválido: {repo}')

        gh_all = [a for a in self.apps24 if a.get('sourceType') == 'github']
        repos_all = [a.get('repository') for a in gh_all]
        self.assertEqual(len(set(repos_all)), 934)

        repo_counts = Counter(repos_all)
        multi_repos = {k: v for k, v in repo_counts.items() if v > 1}
        self.assertEqual(multi_repos, {'spacestate1/namco22-decompile': 5})

    def test_catalog_2026_10_24_tabs_counts(self):
        en = self.enabled24
        win = [a for a in en if (('Windows' in (a.get('platforms') or [])) or a.get('sourceType') == 'local') and a.get('availability') not in ('external-launcher', 'download-unverified')]
        self.assertEqual(len(win), 641)

        lin = [a for a in en if a.get('linuxCompatible') is True or ('Linux' in (a.get('platforms') or []))]
        self.assertEqual(len(lin), 404)

        andro = [a for a in en if a.get('androidCompatible') is True or ('Android' in (a.get('platforms') or [])) or (isinstance(a.get('android'), dict) and a.get('android', {}).get('status'))]
        self.assertEqual(len(andro), 363)

        mac = [a for a in en if 'macOS' in (a.get('platforms') or [])]
        self.assertEqual(len(mac), 211)

        ios = [a for a in en if 'iOS' in (a.get('platforms') or [])]
        self.assertEqual(len(ios), 11)

        switch = [a for a in en if 'Switch' in (a.get('platforms') or [])]
        self.assertEqual(len(switch), 5)

        ds = [a for a in en if any(p in ['3DS', 'Nintendo 3DS'] for p in (a.get('platforms') or []))]
        self.assertEqual(len(ds), 5)

        psp = [a for a in en if 'PSP' in (a.get('platforms') or [])]
        self.assertEqual(len(psp), 2)

        vita = [a for a in en if any(p in ['Vita', 'PS Vita'] for p in (a.get('platforms') or []))]
        self.assertEqual(len(vita), 3)

        wiiu = [a for a in en if any(p in ['Wii U', 'WiiU'] for p in (a.get('platforms') or []))]
        self.assertEqual(len(wiiu), 0)

        ext = [a for a in en if a.get('sourceType') == 'external' or a.get('availability') in ('external-launcher', 'download-unverified') or a.get('downloadPageUrl')]
        self.assertEqual(len(ext), 210)

    def test_catalog_2026_10_24_metadata_security(self):
        quarantined = [a for a in self.apps24 if a.get('quarantinedLinkFields')]
        self.assertEqual(len(quarantined), 90)

        mod_support = [a for a in self.apps24 if a.get('modSupport')]
        self.assertEqual(len(mod_support), 8)

        game_data = [a for a in self.apps24 if a.get('gameData')]
        self.assertEqual(len(game_data), 2)

    def test_catalog_2026_10_22_and_diff(self):
        if not self.apps22:
            self.skipTest('Fixtures 2026.10.22.1 no encontradas')

        self.assertEqual(len(self.apps22), 1118)
        map22 = {a['id']: a for a in self.apps22}
        map24 = {a['id']: a for a in self.apps24}

        altas = set(map24.keys()) - set(map22.keys())
        bajas = set(map22.keys()) - set(map24.keys())
        self.assertEqual(len(altas), 55)
        self.assertEqual(len(bajas), 0)

        common_ids = set(map22.keys()) & set(map24.keys())
        cover_diff_count = 0
        cover_fields = {'coverSource', 'coverStyle', 'coverUrl', 'steamGridDbGameId', 'coverMatchMethod'}
        for aid in common_ids:
            a22 = map22[aid]
            a24 = map24[aid]
            diff_keys = {k for k in set(a22.keys()) | set(a24.keys()) if a22.get(k) != a24.get(k)}
            if diff_keys and diff_keys.issubset(cover_fields):
                cover_diff_count += 1

        self.assertEqual(cover_diff_count, 1076)

    def test_gamewave_emulators_and_webgames(self):
        emu_path = GW_DIR / 'emulators.json'
        if emu_path.exists():
            with open(emu_path, 'r', encoding='utf-8') as f:
                emus = json.load(f)
            emus_list = emus.get('apps', []) if isinstance(emus, dict) else emus
            self.assertEqual(len(emus_list), 88)

        web_path = GW_DIR / 'webgames.json'
        if web_path.exists():
            with open(web_path, 'r', encoding='utf-8') as f:
                web = json.load(f)
            web_list = web.get('apps', []) if isinstance(web, dict) else web
            self.assertEqual(len(web_list), 200)


class TestQuiverFixtures(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(QUIVER_DIR / 'apps_all_pages.json', 'r', encoding='utf-8') as f:
            cls.pages = json.load(f)
        with open(QUIVER_DIR / 'apps_unique.json', 'r', encoding='utf-8') as f:
            cls.unique_apps = json.load(f)

    def test_quiver_pages_and_unique_count(self):
        self.assertEqual(len(self.pages), 9)
        self.assertEqual(len(self.unique_apps), 148)

    def test_quiver_golden_anexo_c2(self):
        apps = self.unique_apps
        catalog_id_count = sum(1 for a in apps if a.get('catalogId'))
        self.assertEqual(catalog_id_count, 113)

        verified_missing = sum(1 for a in apps if 'verified' not in a or a.get('verified') is None)
        self.assertEqual(verified_missing, 2)

        setup_files_count = sum(1 for a in apps if (a.get('launcher') or {}).get('setupFiles'))
        self.assertEqual(setup_files_count, 9)

        preferred_exec_count = sum(1 for a in apps if (a.get('launcher') or {}).get('preferredExecutables'))
        self.assertEqual(preferred_exec_count, 94)

        mods_count = sum(1 for a in apps if (a.get('launcher') or {}).get('mods') or a.get('modSources'))
        self.assertEqual(mods_count, 7)

        project_types = Counter(a.get('projectType') for a in apps)
        self.assertEqual(project_types.get('port'), 145)
        self.assertEqual(project_types.get('game'), 3)

        ai_levels = Counter(a.get('aiLevel') for a in apps)
        self.assertEqual(ai_levels.get('generated'), 68)
        self.assertEqual(ai_levels.get('assisted'), 47)
        self.assertEqual(ai_levels.get('none'), 33)


if __name__ == '__main__':
    unittest.main()
