import { render } from 'preact';
import { App } from './app.js';
import './styles.css';

const root = document.getElementById('app');
if (!root) throw new Error('#app が見つかりません');
render(<App />, root);
