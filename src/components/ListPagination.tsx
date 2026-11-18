import { useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./ui/button";

export function paginate<T>(items: readonly T[], requestedPage: number, pageSize = 50) {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(Math.max(1, requestedPage), pageCount);
  const start = (page - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), page, pageCount, start, total: items.length, pageSize };
}

export function ListPagination({ page, pageCount, total, pageSize = 50, onChange, label = "List pages" }: {
  page: number; pageCount: number; total: number; pageSize?: number; onChange: (page: number) => void; label?: string;
}) {
  return <nav className="list-pagination" aria-label={label}>
    <span aria-live="polite">{total ? (page - 1) * pageSize + 1 : 0}–{Math.min(page * pageSize, total)} of {total}</span>
    <div>
      <Button type="button" variant="secondary" size="icon-sm" disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="Previous page"><ChevronLeft className="h-3.5 w-3.5" /></Button>
      <span>{page} / {pageCount}</span>
      <Button type="button" variant="secondary" size="icon-sm" disabled={page >= pageCount} onClick={() => onChange(page + 1)} aria-label="Next page"><ChevronRight className="h-3.5 w-3.5" /></Button>
    </div>
  </nav>;
}

export function PaginatedList<T>({ items, children, label, pageSize = 50 }: {
  items: readonly T[]; children: (items: T[], start: number) => ReactNode; label?: string; pageSize?: number;
}) {
  const [requestedPage, setPage] = useState(1);
  const pagination = paginate(items, requestedPage, pageSize);
  return <>{children(pagination.items, pagination.start)}<ListPagination {...pagination} onChange={setPage} label={label} /></>;
}
