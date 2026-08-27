export default function Header() {
  return (
    <header>
      <nav className="pager">
        <button type="button" disabled>
          &lt;
        </button>
        <span>0 / 0</span>
        <button type="button" disabled>
          &gt;
        </button>
      </nav>
      <button className="commit" type="button">
        Commit
      </button>
    </header>
  );
}
