import ReactDOM from 'react-dom/client'
import App from '@/App'
import '@/index.css'

// Start-up: mounts <App /> into the empty <div id="root"> in web/index.html.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <App />
)
