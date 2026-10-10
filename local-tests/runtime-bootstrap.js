function install() {}
function uninstall() {}
function shutdown() {}
function onMainWindowLoad() {}
function onMainWindowUnload() {}
function startup() { runTests(); }
async function runTests() {
 const report={passed:[],errors:[],console:[]};
 const listener={observe(m){if(/error|exception|latex|TypeError|ReferenceError/i.test(m.message)) report.console.push(m.message);}};Services.console.registerListener(listener);
 const resultPath='/home/taie/zotero-better-notes/local-tests/runtime/result.json';
 const assert=(ok,message)=>{if(!ok)throw new Error(message);};
 const wait=async(fn,label)=>{for(let i=0;i<300;i++){if(fn())return;await Zotero.Promise.delay(100);}throw new Error('Timeout: '+label);};
 try {
  await Zotero.initializationPromise;
  await wait(()=>Zotero.BetterNotes?.data.initialized,'Better Notes startup');
  const note=new Zotero.Item('note');note.setNote('<p>LaTeX integration test</p>');await note.saveTx();
  await Zotero.getActiveZoteroPane().selectItem(note.id);
  await wait(()=>Zotero.BetterNotes.api.editor.getEditorInstance(note.id),'note editor');
  const ed=Zotero.BetterNotes.api.editor.getEditorInstance(note.id);await ed._initPromise;
  const win=ed._iframeWindow.wrappedJSObject;
  const core=win._currentEditorInstance._editorCore;
  await wait(()=>core.view.state.plugins.some(p=>p.spec.betterNotes==='latexInput'),'LaTeX plugin');
  const view=core.view;
  const formulas=()=>{const out=[];view.state.doc.descendants(n=>{if(n.type.name.startsWith('math_'))out.push({type:n.type.name,tex:n.textContent});});return out;};
  const setContent=(html)=>{const node=win.BetterNotesEditorAPI.getNodeFromHTML(view.state,html);let tr=view.state.tr.replaceWith(0,view.state.doc.content.size,node.content);const T=view.state.selection.constructor;tr.setSelection(T.near(tr.doc.resolve(tr.doc.content.size-1)));view.dispatch(tr);};
  const paste=async(text,html)=>{
   setContent('<p></p>');
   const fake={clipboardData:{types:html?['text/html','text/plain']:['text/plain'],files:[],getData:type=>type==='text/plain'?text:type==='text/html'?(html||''):''},preventDefault(){},shiftKey:false};
   const event=Components.utils.cloneInto(fake,win,{cloneFunctions:true});
   const slice=win.BetterNotesEditorAPI.getSliceFromHTML(view.state,'<p></p>');
   const handled=view.someProp('handlePaste', fn=>fn(view,event,slice));
   report.pasteEvent={handled};
   try {await wait(()=>formulas().length>0,'paste result');} catch(e){report.document=view.state.doc.toJSON();throw e;}
   view.dispatch(view.state.tr.setSelection(view.state.selection.constructor.near(view.state.doc.resolve(0))));
   await Zotero.Promise.delay(150);
  };
  const originalGetSlice=win.BetterNotesEditorAPI.getSliceFromHTML;
 win.BetterNotesEditorAPI.getSliceFromHTML=Components.utils.exportFunction((state,html)=>{report.convertedHTML=html; const slice=originalGetSlice(state,html);report.slice=slice.toJSON();return slice;},win);
 const samples=["\\documentclass{article}\n\\begin{document}\n``first''\n\n\\[a\\]\n\n``second''\n\n    \\[b\\]\n\n\\end{document}",String.raw`\[\boxed{\text{proprioception + object xyz + ego depth}}\]`,String.raw`中文 \(x^2\) 后文`,String.raw`\begin{equation}E=mc^2\end{equation}`,String.raw`\begin{align}a &= b \\ c &= d\end{align}`];
  for(const source of samples){
   await paste(source);
   assert(formulas().length>=1,'formula: '+source.slice(0,60));
   assert(win.document.querySelector('.katex'),'rendered KaTeX: '+source);
   assert(!win.document.querySelector('.katex-error'),'no KaTeX error');
   report.passed.push({action:'paste',sourceLength:source.length,formulaCount:formulas().length});
  }
  await paste('',String.raw`<p><b>标题</b> \[x^2\] 后文</p>`);
  assert(view.state.doc.textContent.includes('标题') && view.state.doc.textContent.includes('后文'),'HTML surrounding text');
  report.passed.push({action:'HTML paste',result:formulas()});
  for(const [html,closing] of [[String.raw`<p>中文 \(x^2\</p>`,')'],[String.raw`<p>\[x^2\</p>`,']'],[String.raw`<p>\begin{align}</p><p>a &amp;= b \\</p><p>c &amp;= d</p><p>\end{align</p>`,'}']]){
   setContent(html);const pos=view.state.selection.from;
   const handled=view.someProp('handleTextInput',fn=>fn(view,pos,pos,closing));
   assert(handled,'typed closing handled');assert(formulas().length===1,'typed formula');
   await Zotero.Promise.delay(150);
   assert(!win.document.querySelector('.katex-error'),'typed no KaTeX error');
   report.passed.push({action:'typing',html,result:formulas(),cursorParent:view.state.selection.$from.parent.type.name});
  }
  ed.saveSync();await Zotero.Promise.delay(300);assert(note.getNote().includes('class="math"'),'saved native math');
  report.passed.push({action:'save',html:note.getNote()});
 }catch(e){report.errors.push(String(e)+'\n'+e.stack);}
 await IOUtils.writeUTF8(resultPath,JSON.stringify(report,null,2));
 Services.startup.quit(Components.interfaces.nsIAppStartup.eAttemptQuit);
}
