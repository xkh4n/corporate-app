import { EmptyState } from "../../components/ui/EmptyState";

export function ModulePlaceholder({ title }: { title: string }) {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
      <EmptyState title="Vista en construccion" description="Este modulo todavia no tiene una pantalla implementada." />
    </div>
  );
}
