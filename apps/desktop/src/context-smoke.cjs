// Synthetic fixtures exercise the shipped renderer without touching a GitHub PR.
async function verifyContextRenderer(window) {
  return window.webContents.executeJavaScript(String.raw`(async () => {
    const wait = async (read, label) => {
      const deadline = Date.now() + 15000;
      for (;;) { const value = read(); if (value) return value; if (Date.now() > deadline) throw new Error(label); await new Promise(resolve => setTimeout(resolve, 50)); }
    };
    const button = (name, root = document) => [...root.querySelectorAll('button')].find(node => node.textContent.trim() === name);
    const roots = (root) => [root, ...[...root.querySelectorAll('*')].flatMap(node => node.shadowRoot ? roots(node.shadowRoot) : [])];
    const codeText = (root) => roots(root).map(part => [...part.querySelectorAll('[data-line]')].map(line => line.textContent).join('\n')).join('\n');
    const keywordColored = (root, word) => roots(root).flatMap(part => [...part.querySelectorAll('[data-line] span')]).some(token => token.textContent.trim() === word && getComputedStyle(token).color !== getComputedStyle(token.closest('[data-line]')).color);
    const originalFetch = globalThis.fetch;
    const originalLocation = location.pathname + location.search;
    const oldLines = Array.from({length: 120}, (_, index) => '  // source line ' + (index + 1));
    oldLines[0] = 'export class Example {';
    oldLines[39] = '  private inspect(value: string) {';
    oldLines[40] = '    return value';
    oldLines[69] = '  }';
    oldLines[79] = '  async run() { return this.inspect("source") }';
    oldLines[119] = '}';
    const newLines = [...oldLines]; newLines[50] = '    // first selected change'; newLines[100] = '  // hidden other group change';
    const hunk = (id, start) => ({id, fileId:'example-file', header:'@@ -'+start+',5 +'+start+',5 @@',lines:Array.from({length:5}, (_, offset) => start+offset).flatMap(number => number === start+2 ? [{id:id+'old',kind:'removed',text:oldLines[number-1],oldLine:number,newLine:null},{id:id+'new',kind:'added',text:newLines[number-1],oldLine:null,newLine:number}] : [{id:id+number,kind:'context',text:oldLines[number-1],oldLine:number,newLine:number}])});
    const first = hunk('first-hunk',49); const second=hunk('second-hunk',99);
    const sha='b'.repeat(40);
    const source={path:'src/example.ts',sha,content:newLines.join('\n')+'\n',symbols:[{name:'Example',kind:'class',line:1,endLine:120},{name:'Example.inspect',kind:'method',line:40,endLine:70},{name:'Example.run',kind:'method',line:80,endLine:80}]};
    const pull={id:'native-context-smoke',owner:'example',repo:'demo',number:1,url:'https://github.com/example/demo/pull/1',title:'Synthetic context smoke',description:'## Smoke description\n\nA **formatted** description with [safe link](https://github.com/example/demo).',author:'reviewer',baseBranch:'main',headBranch:'feature',baseSha:'a'.repeat(40),mergeBaseSha:'a'.repeat(40),headSha:sha,state:'open',files:[{id:'example-file',path:source.path,status:'modified',additions:2,deletions:2,hunks:[first,second],coverage:'complete',oldContent:oldLines.join('\n')+'\n'}],groups:[{id:'first-group',title:'First group',reason:'Smoke fixture',priority:'P2',fileIds:['example-file'],hunkIds:[first.id]},{id:'second-group',title:'Second group',reason:'Smoke fixture',priority:'P2',fileIds:['example-file'],hunkIds:[second.id]}],transfers:[],groupingSource:'codex',warnings:[]};
    const draft={comments:[],summary:'',viewedFileIds:[],viewedHunkIds:[]};
    let contentRequests=0, navigationRequests=[];
    globalThis.fetch=async(input,init) => {
      const url=new URL(typeof input==='string'?input:input.url,location.href);
      if(url.pathname==='/api/pulls/'+pull.id)return Response.json(pull);
      if(url.pathname==='/api/pulls/'+pull.id+'/draft')return Response.json({draft,exists:false});
      if(url.pathname==='/api/pulls/'+pull.id+'/threads')return Response.json({threads:[]});
      if(url.pathname==='/api/pulls/'+pull.id+'/files/example-file/content'){contentRequests++;return Response.json({fileId:'example-file',old:{...source,sha:pull.baseSha,content:oldLines.join('\n')+'\n'},new:source});}
      if(url.pathname==='/api/pulls/'+pull.id+'/source-tree')return Response.json({sha,paths:[source.path,'src/related.ts'],warnings:[]});
      if(url.pathname==='/api/pulls/'+pull.id+'/source-file')return Response.json(url.searchParams.get('path')==='src/related.ts'?{path:'src/related.ts',sha,content:'export function related() { return 42 }\n',symbols:[{name:'related',kind:'function',line:1,endLine:1}]}:source);
      if(url.pathname==='/api/pulls/'+pull.id+'/navigation'){navigationRequests.push(JSON.parse(init.body));return Response.json({language:'typescript',mode:'semantic',targets:[{path:'src/related.ts',line:1,column:17,endLine:1,endColumn:24,name:'related'}],warnings:[]});}
      if(url.pathname.startsWith('/api/pulls/'+pull.id+'/') || url.pathname==='/api/stack' || url.pathname==='/api/inbox' || url.pathname==='/api/inbox-status')return Response.json({error:'Synthetic fixture metadata unavailable'},{status:400});
      return originalFetch(input,init);
    };
    try {
      history.pushState({},'', '/repos/example/demo/pulls/1?revision='+pull.id);dispatchEvent(new PopStateEvent('popstate'));
      await wait(() => button('+20 context'), 'Review workspace did not load context controls');
      await wait(() => !button('+20 context').disabled, 'Exact context did not become ready');
      const view=await wait(() => document.querySelector('.viewer'), 'Diff viewer missing');
      await wait(() => codeText(view).includes('first selected change'), 'Selected hunk did not render');
      const before=roots(view).reduce((count,root)=>count+root.querySelectorAll('[data-line]').length,0);
      button('+20 context').click();
      await wait(() => roots(view).reduce((count,root)=>count+root.querySelectorAll('[data-line]').length,0)>before, 'Context did not expand');
      if(codeText(view).includes('hidden other group change'))throw new Error('Context crossed into an omitted changed group');
      await wait(() => keywordColored(view,'private'), 'Partial diff method keyword was not syntax highlighted');
      if(contentRequests!==1)throw new Error('Context content cache was not reused');
      button('Browse source').click();
      const panel=await wait(() => document.querySelector('.source-context-dialog'), 'Source panel did not open');
      await wait(() => panel.querySelector('.source-context-viewer') && codeText(panel).includes('private inspect'), 'Source viewer did not load lexical method context');
      const outline=panel.querySelector('select[aria-label="Go to function or symbol"]');
      if(!outline || !outline.textContent.includes('Example.inspect'))throw new Error('Source outline unavailable');
      outline.value='80';outline.dispatchEvent(new Event('change',{bubbles:true}));
      await wait(() => codeText(panel).includes('async run'), 'Outline did not navigate to the method');
      await wait(() => keywordColored(panel,'async'), 'Full source async keyword was not syntax highlighted');
      const token=await wait(() => roots(panel).flatMap(root=>[...root.querySelectorAll('[data-char]')]).find(node=>node.textContent.trim()==='inspect'), 'Source identifier tokens unavailable');
      token.dispatchEvent(new MouseEvent('click',{bubbles:true,composed:true}));
      await wait(() => button('Go to definition',panel) && !button('Go to definition',panel).disabled, 'Source token did not select');
      button('Go to definition',panel).click();
      await wait(() => panel.querySelector('.source-context-targets button'), 'Definition results did not render');
      panel.querySelector('.source-context-targets button').click();
      await wait(() => codeText(panel).includes('function related'), 'Definition target did not open');
      const relatedToken=await wait(() => roots(panel).flatMap(root=>[...root.querySelectorAll('[data-char]')]).find(node=>node.textContent.trim()==='related'), 'Definition identifier tokens unavailable');
      relatedToken.dispatchEvent(new MouseEvent('click',{bubbles:true,composed:true}));
      await wait(() => !button('Find references',panel).disabled, 'Reference token did not select');
      button('Find references',panel).click();
      await wait(() => navigationRequests.some(request=>request.kind==='references'), 'References request did not use selected source token');
      await wait(() => !button('Back to file',panel).disabled, 'Reference lookup did not finish');
      if(navigationRequests[0].column<1 || navigationRequests[0].side!=='RIGHT')throw new Error('Source navigation coordinate or revision incorrect');
      button('Back to file',panel).click();
      await wait(() => panel.querySelector('[data-slot="dialog-title"]')?.textContent==='src/example.ts', 'Source history did not return');
      button('Files',panel).click();
      await wait(() => panel.querySelector('.source-context-files button'), 'Source file picker did not load');
      button('Back to diff',panel).click();
      await wait(() => !document.querySelector('.source-context-dialog'), 'Source panel did not return to the diff');
      button('Reset').click();
      await wait(() => roots(view).reduce((count,root)=>count+root.querySelectorAll('[data-line]').length,0)===before, 'Reset did not restore canonical display');
      button('PR description').click();
      const description=await wait(() => document.querySelector('.description-dialog'), 'Description dialog did not open');
      if(!description.querySelector('.description-body h2') || !description.querySelector('strong') || !description.querySelector('a[href="https://github.com/example/demo"]'))throw new Error('Description Markdown did not render');
      description.querySelector('button[aria-label="Close"]')?.click();
      await wait(() => !document.querySelector('.description-dialog'), 'Description dialog did not close');
      return {contextUI:true,sourceNavigation:true,syntaxColors:true,descriptionMarkdown:true};
    } finally {
      history.pushState({},'',originalLocation);dispatchEvent(new PopStateEvent('popstate'));
      await new Promise(resolve=>setTimeout(resolve,100));
      globalThis.fetch=originalFetch;
    }
  })()`)
}
module.exports = { verifyContextRenderer }
