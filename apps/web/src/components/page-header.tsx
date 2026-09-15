/**
 * Standard page header: kicker, title and the page's honest description.
 * One component keeps heading hierarchy and page rhythm consistent.
 */
export function PageHeader({
  kicker,
  title,
  description,
}: {
  kicker: string;
  title: string;
  description: string;
}) {
  return (
    <header className="page-header">
      <p className="page-kicker">{kicker}</p>
      <h1 className="page-title">{title}</h1>
      <p className="page-description">{description}</p>
    </header>
  );
}
