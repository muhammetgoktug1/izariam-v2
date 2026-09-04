/**
 * The notepad, izariam/views/avatarNotes.php.
 *
 * One text field per account, shown in a draggable YUI panel the legacy
 * remembered the position of in five cookies. The markup contract is the
 * nesting -- `#resizablepanel > .hd > .div1 > .div2` and so on -- because the
 * skin draws the frame out of it; the drag behaviour came from YUI and is not
 * reproduced, so the panel sits where the stylesheet puts it.
 *
 * The legacy saved through `actions/notes`, an endpoint whose handler writes
 * the text and nothing else; here it is `PUT /api/notes`.
 */

import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'

import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'

interface Props {
  initial: string
  onClose: () => void
}

export function NotesPanel({ initial, onClose }: Props) {
  const [text, setText] = useState(initial)
  const save = useMutation({ mutationFn: () => api.saveNotes(text) })

  const close = () => {
    save.mutate(undefined, { onSettled: onClose })
  }

  return (
    <div className="yui-skin-sam" style={{ zIndex: 9999999, position: 'absolute' }}>
      <div id="examplecontainer">
        <div id="resizablepanel">
          <div className="hd">
            <div className="div1">
              <div className="div2">
                <p>
                  {t('notes')}
                  <span>
                    <a
                      href="#"
                      onClick={(e) => {
                        e.preventDefault()
                        close()
                      }}
                    >
                      <img src="/skin/layout/notes_close.gif" alt={t('close')} />
                    </a>
                  </span>
                </p>
              </div>
            </div>
          </div>
          <div className="bd">
            <div className="rightborder">
              <div id="messageBox">
                <textarea
                  id="message"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
              </div>
            </div>
          </div>
          <div className="ft">
            <div className="bottom">
              <span className="chars" id="chars">
                {text.length}
              </span>
              {t('characters')}
            </div>
          </div>
          <center>
            <div className="button2">
              <a
                href="#"
                className="button notice"
                onClick={(e) => {
                  e.preventDefault()
                  close()
                }}
              >
                {t('ok')}
              </a>
            </div>
          </center>
        </div>
      </div>
    </div>
  )
}
