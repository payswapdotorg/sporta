import { A11Y } from "@/lib/a11y";
import { NavIcon } from "@/components/nav-icon";

/**
 * The header search seam (W903). A plain GET form: submitting navigates to
 * /search with the user's own query — no client state, no fake suggestions.
 * On small screens it collapses to a search action that opens /search.
 */
export function SearchBox() {
  return (
    <form className="search-box" role="search" action="/search">
      <label className="sr-only" htmlFor="site-search-input">
        {A11Y.searchInputLabel}
      </label>
      <input
        id="site-search-input"
        className="search-input"
        type="search"
        name="q"
        autoComplete="off"
        placeholder={A11Y.searchInputLabel}
      />
      <button className="search-submit" type="submit">
        <NavIcon name="search" />
        <span className="sr-only">Run search</span>
      </button>
    </form>
  );
}
