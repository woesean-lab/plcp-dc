import { useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./ui/button";
import { FilterDropdown } from "./ui/filter-dropdown";

export function paginate<T>(items: readonly T[], requestedPage: number, pageSize = 50) {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(Math.max(1, requestedPage), pageCount);
  const start = (page - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), page, pageCount, start, total: items.length, pageSize };
}

export function ListPagination({ page, pageCount, total, pageSize = 50, onChange, onPageSizeChange, label = "List pages", showNavigationLabels = false }: {
  page: number; pageCount: number; total: number; pageSize?: number; onChange: (page: number) => void; onPageSizeChange: (size: number) => void; label?: string; showNavigationLabels?: boolean;
}) {
  return <nav className="list-pagination" aria-label={label}>
    <span aria-live="polite">{total ? (page - 1) * pageSize + 1 : 0}–{Math.min(page * pageSize, total)} of {total}</span>
    <div>
      <div className="list-page-size">
        <span>Per page</span>
        <FilterDropdown
          label={`${label}: items per page`}
          showLabel={false}
          placement="top"
          portal
          value={String(pageSize)}
          options={[50, 100, 200, 500].map((size) => ({ value: String(size), label: String(size) }))}
          onChange={(value) => { onPageSizeChange(Number(value)); onChange(1); }}
        />
      </div>
      <Button type="button" variant="secondary" size={showNavigationLabels ? "xs" : "icon-sm"} className={showNavigationLabels ? "list-page-nav" : undefined} disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="Previous page"><ChevronLeft className="h-3.5 w-3.5" />{showNavigationLabels ? "Back" : null}</Button>
      <span>{page} / {pageCount}</span>
      <Button type="button" variant="secondary" size={showNavigationLabels ? "xs" : "icon-sm"} className={showNavigationLabels ? "list-page-nav" : undefined} disabled={page >= pageCount} onClick={() => onChange(page + 1)} aria-label="Next page">{showNavigationLabels ? "Next" : null}<ChevronRight className="h-3.5 w-3.5" /></Button>
    </div>
  </nav>;
}

export function PaginatedList<T>({ items, children, label, pageSize: initialPageSize = 50 }: {
  items: readonly T[]; children: (items: T[], start: number) => ReactNode; label?: string; pageSize?: number;
}) {
  const [requestedPage, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const pagination = paginate(items, requestedPage, pageSize);
  return <>{children(pagination.items, pagination.start)}<ListPagination {...pagination} onChange={setPage} onPageSizeChange={setPageSize} label={label} /></>;
}
