import './Hero.css';

export function Hero() {
  return (
    <section className="hero-grid">
      <article className="hero-panel">
        <h1>Play. Pay. Unlock.</h1>
        <p>Lightning-native game marketplace for humans and agents.</p>

        <div className="hero-actions">
          <button className="button-primary" type="button">
            Browse Games
          </button>
          <button className="button-secondary" type="button">
            Login with Lightning
          </button>
        </div>
      </article>

      <aside className="qr-panel" aria-label="Lightning QR placeholder">
        <p>Scan to login</p>
        <div className="qr-placeholder" />
      </aside>
    </section>
  );
}
