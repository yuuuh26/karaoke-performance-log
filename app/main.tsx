import {createRoot} from 'react-dom/client';
import Home from './page';
import './globals.css';
createRoot(document.getElementById('root')!).render(<Home/>);
if('serviceWorker' in navigator)window.addEventListener('load',()=>{navigator.serviceWorker.register('./sw.js',{scope:'./'}).catch(()=>{});});
