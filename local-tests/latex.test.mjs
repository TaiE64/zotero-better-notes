import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { Schema, Fragment, DOMParser as PMParser } from "prosemirror-model";
import { EditorState, TextSelection } from "prosemirror-state";
import katex from "katex";

await build({
  entryPoints: [
    "src/extras/shared/latexMath.ts",
    "src/extras/editor/latexInput.ts",
    "src/extras/convert.ts",
  ],
  outdir: "local-tests/build",
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
});
const { findLatexMath, normalizeLatexMath, convertLatexHTML } = await import(
  "./build/shared/latexMath.js"
);
const { handleLatexInput } = await import("./build/editor/latexInput.js");
const { md2html } = await import("./build/convert.js");
const dom = new JSDOM("");
globalThis.DOMParser = dom.window.DOMParser;
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      group: "block",
      content: "inline*",
      parseDOM: [{ tag: "p" }],
      toDOM: () => ["p", 0],
    },
    text: { group: "inline" },
    hardBreak: {
      inline: true,
      group: "inline",
      parseDOM: [{ tag: "br" }],
      toDOM: () => ["br"],
    },
    math_inline: {
      group: "inline math",
      content: "text*",
      marks: "",
      inline: true,
      atom: true,
      parseDOM: [
        {
          tag: "span.math",
          getContent: (e, s) =>
            Fragment.from(s.text(e.textContent.trim().slice(1, -1))),
        },
      ],
      toDOM: (n) => ["span", { class: "math" }, "$" + n.textContent + "$"],
    },
    math_display: {
      group: "block math",
      content: "text*",
      atom: true,
      code: true,
      parseDOM: [
        {
          tag: "pre.math",
          getContent: (e, s) =>
            Fragment.from(s.text(e.textContent.trim().slice(2, -2))),
        },
      ],
      toDOM: (n) => ["pre", { class: "math" }, "$$" + n.textContent + "$$"],
    },
    codeBlock: {
      group: "block",
      content: "text*",
      code: true,
      parseDOM: [{ tag: "pre" }],
      toDOM: () => ["pre", 0],
    },
    bulletList: { group: "block", content: "listItem+" },
    listItem: { content: "block+" },
  },
  marks: {
    code: { code: true, toDOM: () => ["code", 0] },
    link: {
      attrs: { href: {} },
      toDOM: (m) => ["a", { href: m.attrs.href }, 0],
    },
  },
});
const r = String.raw;
function formulas(doc) {
  const out = [];
  doc.descendants((n) => {
    if (n.type.name.startsWith("math_")) out.push([n.type.name, n.textContent]);
  });
  return out;
}
function parse(html) {
  const el = dom.window.document.createElement("div");
  el.innerHTML = html;
  return PMParser.fromSchema(schema).parse(el);
}
function input(paragraphs, last, opts = {}) {
  const ps = paragraphs.map((text) =>
    schema.node(
      opts.codeBlock ? "codeBlock" : "paragraph",
      null,
      text ? schema.text(text, opts.code ? [schema.mark("code")] : []) : null,
    ),
  );
  const doc = opts.list
    ? schema.node("doc", null, [
        schema.node("bulletList", null, [schema.node("listItem", null, ps)]),
      ])
    : schema.node("doc", null, ps);
  const cursor = doc.content.size - (opts.list ? 3 : 1);
  let state = EditorState.create({
    doc,
    selection: TextSelection.create(doc, cursor),
  });
  const view = {
    get state() {
      return state;
    },
    composing: !!opts.composing,
    dispatch(tr) {
      state = state.apply(tr);
    },
  };
  const handled = handleLatexInput(view, cursor, cursor, last);
  return { handled, state };
}

test("screenshot formula becomes a native display formula", async () => {
  const source = r`\[\boxed{\text{proprioception + object xyz + ego depth}}\]`;
  const result = parse(await md2html(source));
  assert.deepEqual(formulas(result), [
    ["math_display", r`\boxed{\text{proprioception + object xyz + ego depth}}`],
  ]);
  katex.renderToString(formulas(result)[0][1], {
    throwOnError: true,
    displayMode: true,
  });
});
test("mixed Chinese prose, inline math and display math", async () => {
  const doc = parse(await md2html(r`前面 \(x^2\) 中间 \[\frac{a}{b}\] 后面`));
  assert.equal(formulas(doc).length, 2);
  assert.ok(doc.textContent.includes("前面"));
  assert.ok(doc.textContent.includes("后面"));
});
test("equation and align environments render with KaTeX", async () => {
  for (const env of [
    "equation",
    "equation*",
    "align",
    "align*",
    "gather",
    "gather*",
  ]) {
    const body = env.startsWith("align") ? r`a &= b \\ c &= d` : r`E=mc^2`;
    const source = `\\begin{${env}}\n${body}\\label{eq:test}\n\\end{${env}}`;
    const doc = parse(await md2html(source));
    const fs = formulas(doc);
    assert.equal(fs.length, 1, env);
    katex.renderToString(fs[0][1], { throwOnError: true, displayMode: true });
  }
});
test("code, incomplete delimiters, escaped delimiters, dollar math and link URLs remain literal", () => {
  for (const source of [
    r`\(unfinished`,
    r`\\[x\\]`,
    "`" + r`\(x\)` + "`",
    "```latex\n" + r`\[x\]` + "\n```",
    "~~~tex\n" + r`\[x\]` + "\n~~~",
    "```\n" + r`\[x\]`,
    "    " + r`\(x\)`,
    "<pre>" + r`\[x\]` + "</pre>",
    r`$\text{\(x\)}$`,
    r`[link](https://example.org/\(x\))`,
  ])
    assert.equal(normalizeLatexMath(source), source, source);
});
test("two displays and multiline alignment preserve ordering", async () => {
  const doc = parse(await md2html(r`\[a\] and \[b\]`));
  assert.equal(formulas(doc).length, 2);
});
test("HTML clipboard preserves formatting, code, attributes and literal angle brackets", async () => {
  const html =
    "<p><b>说明</b> " +
    r`\(x&lt;y\)` +
    "</p><pre>" +
    r`\[code\]` +
    '</pre><a href="https://example.org/">' +
    r`\(link\)` +
    "</a>";
  const out = convertLatexHTML(html, new DOMParser());
  assert.ok(out.includes("<b>说明</b>"));
  assert.ok(out.includes("x&lt;y"));
  assert.ok(out.includes(r`\[code\]`));
  assert.ok(out.includes(r`\(link\)`));
  const doc = parse(await md2html(out));
  assert.equal(formulas(doc).length, 1);
});
test("HTML display math is lifted out of a paragraph without losing surrounding text", async () => {
  const out = convertLatexHTML(
    "<p>before " + r`\[x^2\]` + " after</p>",
    new DOMParser(),
  );
  const doc = parse(await md2html(out));
  assert.equal(formulas(doc).length, 1);
  assert.ok(doc.textContent.includes("before"));
  assert.ok(doc.textContent.includes("after"));
});
test("typing inline closing delimiter creates a formula and leaves cursor after it", () => {
  const { handled, state } = input([r`中文 \(x^2` + "\\"], ")");
  assert.equal(handled, true);
  assert.deepEqual(formulas(state.doc), [["math_inline", "x^2"]]);
  assert.equal(state.selection.$from.parent.type.name, "paragraph");
});
test("typing a display closing delimiter creates an editable following paragraph", () => {
  const { handled, state } = input([r`before \[x^2` + "\\"], "]");
  assert.equal(handled, true);
  assert.deepEqual(formulas(state.doc), [["math_display", "x^2"]]);
  assert.equal(state.doc.lastChild.type.name, "paragraph");
  assert.equal(state.selection.$from.parent.type.name, "paragraph");
});
test("typing multiline align closing environment works across paragraphs", () => {
  const { handled, state } = input(
    [r`\begin{align}`, r`a &= b \\`, r`c &= d`, r`\end{align`],
    "}",
  );
  assert.equal(handled, true);
  const fs = formulas(state.doc);
  assert.equal(fs.length, 1);
  katex.renderToString(fs[0][1], { throwOnError: true, displayMode: true });
});
test("typing display math in a list keeps the list structure", () => {
  const { handled, state } = input([r`\[x` + "\\"], "]", { list: true });
  assert.equal(handled, true);
  assert.equal(state.doc.firstChild.type.name, "bulletList");
  assert.equal(formulas(state.doc).length, 1);
});
test("typing in code or during composition never converts", () => {
  for (const opts of [{ code: true }, { codeBlock: true }, { composing: true }])
    assert.equal(input([r`\(x` + "\\"], ")", opts).handled, false);
});
test("unclosed and escaped typing delimiters remain plain text", () => {
  assert.equal(input([r`\\(x` + "\\"], ")").handled, false);
  assert.equal(input(["normal text"], ")").handled, false);
});

test('browser bundle pastes a standalone display formula without unwrapping it', async () => {
  const script = await build({entryPoints:['src/extras/editorScript.ts'],bundle:true,platform:'browser',format:'iife',write:false});
  const browser = new JSDOM('<!doctype html><html><body></body></html>',{runScripts:'outside-only'});
  browser.window.eval(script.outputFiles[0].text);
  for (const html of ['<pre class="math">$$x^2$$</pre>','<p><span class="math">$x^2$</span></p>']) {
    const doc = schema.node('doc',null,[schema.node('paragraph')]);
    const state = EditorState.create({doc});
    const slice = browser.window.BetterNotesEditorAPI.getSliceFromHTML(state,html);
    const next = state.apply(state.tr.replaceSelection(slice));
    assert.equal(formulas(next.doc).length,1);
    assert.equal(formulas(next.doc)[0][1],'x^2');
  }
});

test("TeX document quotes and indentation do not hide formulas", async () => {
  const source = "\\documentclass{article}\n\\begin{document}\n``first''\n\n\\[a\\]\n\n``second''\n\n    \\[b\\]\n\n\\end{document}";
  assert.equal(findLatexMath(source).length, 2);
  assert.deepEqual(formulas(parse(await md2html(source))), [["math_display", "a"], ["math_display", "b"]]);
});
