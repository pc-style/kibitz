import '@fontsource/schibsted-grotesk/400.css';
import '@fontsource/schibsted-grotesk/500.css';
import '@fontsource/schibsted-grotesk/700.css';
import '@fontsource/martian-mono/400.css';
import '@fontsource/martian-mono/600.css';
import '@lichess-org/chessground/assets/chessground.base.css';
import '@lichess-org/chessground/assets/chessground.cburnett.css';
import './pieces.css';
import './styles.css';
import { render } from 'preact';
import { App } from './app';

render(<App />, document.getElementById('app')!);
