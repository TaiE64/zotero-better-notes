import zipfile,json,pathlib,shutil
p=pathlib.Path(__file__).resolve().parent/'runtime/profile'
m={'manifest_version':2,'name':'Local LaTeX Integration Test','version':'1.0.2','description':'Temporary local test runner','author':'Local','applications':{'zotero':{'id':'latex-test@local.example','update_url':'https://example.invalid/updates.json','strict_min_version':'8.0','strict_max_version':'10.99.99'}}}
with zipfile.ZipFile(p/'extensions/latex-test@local.example.xpi','w',zipfile.ZIP_DEFLATED) as z:z.writestr('manifest.json',json.dumps(m));z.write(p.parent.parent/'runtime-bootstrap.js','bootstrap.js')
for name in ['extensions.json','addonStartup.json.lz4','compatibility.ini']:(p/name).unlink(missing_ok=True)
shutil.rmtree(p/'startupCache',ignore_errors=True)
(p.parent/'result.json').unlink(missing_ok=True)
shutil.copy2(p.parents[2]/'build/better-notes-for-zotero-la-te-x.xpi',p/'extensions/Knowledge4Zotero-latex@local.example.xpi')
