'use client';

import { useEffect, useRef, useState } from 'react';
import type { EditorView } from '@codemirror/view';

type Language = 'typescript' | 'python';

/**
 * A small code editor for homepage examples, built on CodeMirror. Until the
 * editor loads (it is imported lazily in the browser), the code renders as
 * plain text with line numbers so the layout does not shift.
 */
export function EditableCode({
  value,
  onChange,
  language,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  language: Language;
  label: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    let cancelled = false;
    let view: EditorView | null = null;

    (async () => {
      const [{ EditorState }, viewModule, commands, languageModule, { javascript }, { python }, { tags }] = await Promise.all([
        import('@codemirror/state'),
        import('@codemirror/view'),
        import('@codemirror/commands'),
        import('@codemirror/language'),
        import('@codemirror/lang-javascript'),
        import('@codemirror/lang-python'),
        import('@lezer/highlight'),
      ]);
      if (cancelled || !containerRef.current) return;

      const { EditorView: View, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } = viewModule;
      const { defaultKeymap, history, historyKeymap, indentWithTab } = commands;
      const { HighlightStyle, bracketMatching, indentOnInput, indentUnit, syntaxHighlighting } = languageModule;

      const highlightStyle = HighlightStyle.define([
        { tag: [tags.keyword, tags.controlKeyword, tags.moduleKeyword, tags.definitionKeyword, tags.operatorKeyword], class: 'cm-hq-keyword' },
        { tag: [tags.string, tags.special(tags.string)], class: 'cm-hq-string' },
        { tag: [tags.number, tags.bool, tags.null], class: 'cm-hq-number' },
        { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], class: 'cm-hq-function' },
        { tag: [tags.propertyName, tags.attributeName], class: 'cm-hq-property' },
        { tag: [tags.className, tags.typeName], class: 'cm-hq-type' },
        { tag: tags.comment, class: 'cm-hq-comment' },
        { tag: [tags.punctuation, tags.bracket, tags.operator], class: 'cm-hq-punctuation' },
      ]);

      view = new View({
        parent: containerRef.current,
        state: EditorState.create({
          doc: value,
          extensions: [
            lineNumbers(),
            highlightActiveLine(),
            highlightActiveLineGutter(),
            drawSelection(),
            history(),
            bracketMatching(),
            indentOnInput(),
            indentUnit.of(language === 'python' ? '    ' : '  '),
            keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
            language === 'python' ? python() : javascript({ typescript: true }),
            syntaxHighlighting(highlightStyle),
            View.contentAttributes.of({ 'aria-label': label }),
            View.updateListener.of((update) => {
              if (update.docChanged) onChangeRef.current(update.state.doc.toString());
            }),
          ],
        }),
      });
      viewRef.current = view;
      setReady(true);
    })();

    return () => {
      cancelled = true;
      view?.destroy();
      viewRef.current = null;
      setReady(false);
    };
    // The editor is created once per language; later value changes are synced below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, label]);

  // Push outside changes (Reset, switching examples) into the editor.
  useEffect(() => {
    const view = viewRef.current;
    if (view && view.state.doc.toString() !== value) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    }
  }, [value, ready]);

  const lines = value.split('\n');

  return (
    <div className="editable-code min-h-[280px] font-mono text-[11px] leading-[1.75] sm:text-xs">
      <div ref={containerRef} className={ready ? '' : 'hidden'} />
      {!ready && (
        <pre aria-hidden="true" className="editable-code-fallback m-0 overflow-x-auto text-text">
          {lines.map((line, index) => (
            <div key={index} className="flex">
              <span className="w-8 shrink-0 select-none pr-4 text-right text-text-dim">{index + 1}</span>
              <span className="whitespace-pre">{line || ' '}</span>
            </div>
          ))}
        </pre>
      )}
    </div>
  );
}
