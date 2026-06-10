function Menu({ show, onClose, theme }) {
  if (!show) return null

  const apps = [
    { name: 'Hye Code Editor', url: 'https://hyecode.vercel.app' },
    { name: 'Hye Extensions', url: 'https://hyeextensions.vercel.app' },
    
  ]

  return (
    <>
      <div className="menu-overlay" onClick={onClose} />

      <div className="menu-container" data-theme={theme}>
        <div className="menu-header">
          <span>HYE ECOSYSTEM</span>
          <button onClick={onClose}>×</button>
        </div>

        {apps.map((app) => (
          <a
            key={app.url}
            href={app.url}
            target="_blank"
            rel="noreferrer"
            className="menu-item"
            onClick={onClose}
          >
            {app.name}
          </a>
        ))}
      </div>
    </>
  )
}

export default Menu