import React from 'react';
import { createRoot } from 'react-dom/client';
import { ChatInputView } from '../client/chat-input-view.js';
import css from '../client/styles.css';
import desktopCss from './styles.css';
const style = document.createElement('style');
style.textContent = css + '\n' + desktopCss + '\nhtml,body,#root{margin:0;width:100%;height:100%;overflow:hidden;background:#fff}';
document.head.append(style);
createRoot(document.getElementById('root')!).render(<ChatInputView />);
