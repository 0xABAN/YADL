export default function Header() {
  return (
    <header>
      <span>Imigen</span>
      <nav>
        <button type="button" disabled>
          &lt;
        </button>
        <span>0 / 0</span>
        <button type="button" disabled>
          &gt;
        </button>
      </nav>
      <button type="button">Commit</button>
    </header>
  );
}
