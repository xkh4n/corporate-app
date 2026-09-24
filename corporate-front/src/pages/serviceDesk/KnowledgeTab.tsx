import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { Button, EmptyState, Field, Input, Modal, Select, Textarea } from "../../components/ui";
import { showSuccessToast } from "../../components/Toast";
import { handleError } from "../../lib/Errors";
import { kbArticleService } from "../../services/serviceDeskService";
import type { KbArticle, KbArticleSummary, KbAudience, KbStatus, ServiceCategory } from "../../types/serviceDesk";
import { formatDateTime } from "../inventario/inventoryLabels";
import { Pager } from "../contabilidad/Pager";
import { Badge, BackButton, CARD, Loading, PlainText, Section, TD, TH } from "./components";
import { KB_AUDIENCE_LABELS, KB_STATUS_CLASSES, KB_STATUS_LABELS } from "./serviceDeskLabels";

// Gestion del conocimiento (plan 009, fase 9E): redactar, revisar, publicar
// (con version) y retirar articulos. Texto plano: nunca se interpreta HTML.

export function KnowledgeTab({ onOpen, categories }: { onOpen: (id: number) => void; categories: ServiceCategory[] }) {
  const navigate = useNavigate();
  const { can } = useAuth();
  const [articles, setArticles] = useState<KbArticleSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<KbStatus | "">("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totals, setTotals] = useState({ totalPages: 1, totalItems: 0 });
  const [creating, setCreating] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    setLoading(true);
    kbArticleService
      .list({ page, limit: 25, status: status || undefined, search: search.trim() || undefined })
      .then((res) => {
        setArticles(res.items);
        setTotals({ totalPages: res.pagination.totalPages, totalItems: res.pagination.totalItems });
      })
      .catch((error) => handleError(error, navigate))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, status, reload, navigate]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setPage(1);
            setReload((value) => value + 1);
          }}
        >
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar artículos" aria-label="Buscar artículos" />
          <Button type="submit" variant="secondary">
            Buscar
          </Button>
        </form>
        <Select aria-label="Estado" value={status} onChange={(e) => { setStatus(e.target.value as KbStatus | ""); setPage(1); }}>
          <option value="">Todos los estados</option>
          {(Object.keys(KB_STATUS_LABELS) as KbStatus[]).map((value) => (
            <option key={value} value={value}>
              {KB_STATUS_LABELS[value]}
            </option>
          ))}
        </Select>
        {can("kb-articles:create") && (
          <Button type="button" className="ml-auto" onClick={() => setCreating(true)}>
            Nuevo artículo
          </Button>
        )}
      </div>
      {loading ? (
        <Loading />
      ) : articles.length === 0 ? (
        <EmptyState title="Sin artículos" description="Documente soluciones recurrentes para que los usuarios se ayuden solos." />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className={TH}>Número</th>
                  <th className={TH}>Título</th>
                  <th className={TH}>Estado</th>
                  <th className={TH}>Audiencia</th>
                  <th className={TH}>Versión</th>
                  <th className={TH}>Útil sí/no</th>
                  <th className={TH}>Vistas</th>
                  <th className={TH}>Actualizado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {articles.map((article) => (
                  <tr key={article.id}>
                    <td className={TD}>
                      <button type="button" className="font-semibold text-brand-700 hover:underline" onClick={() => onOpen(article.id)}>
                        {article.number}
                      </button>
                    </td>
                    <td className={TD}>
                      {article.title}
                      <div className="text-xs text-slate-500">{article.categoryName ?? ""}</div>
                    </td>
                    <td className={TD}>
                      <Badge className={KB_STATUS_CLASSES[article.status]}>{KB_STATUS_LABELS[article.status]}</Badge>
                    </td>
                    <td className={TD}>{KB_AUDIENCE_LABELS[article.audience]}</td>
                    <td className={TD}>{article.version || "-"}</td>
                    <td className={TD}>
                      {article.helpfulYes}/{article.helpfulNo}
                    </td>
                    <td className={TD}>{article.views}</td>
                    <td className={`${TD} whitespace-nowrap`}>{formatDateTime(article.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} totalPages={totals.totalPages} totalItems={totals.totalItems} noun="artículos" onChange={setPage} />
        </>
      )}
      {creating && (
        <ArticleFormModal
          categories={categories}
          onClose={() => setCreating(false)}
          onSaved={(id) => {
            setCreating(false);
            onOpen(id);
          }}
        />
      )}
    </div>
  );
}

function ArticleFormModal({
  article,
  categories,
  onClose,
  onSaved,
}: {
  article?: KbArticle;
  categories: ServiceCategory[];
  onClose: () => void;
  onSaved: (id: number) => void;
}) {
  const navigate = useNavigate();
  const [title, setTitle] = useState(article?.title ?? "");
  const [body, setBody] = useState(article?.body ?? "");
  const [categoryId, setCategoryId] = useState<number | "">(article?.categoryId ?? "");
  const [audience, setAudience] = useState<KbAudience>(article?.audience ?? "PUBLIC");
  const [saving, setSaving] = useState(false);

  async function save(): Promise<void> {
    setSaving(true);
    try {
      const payload = { title: title.trim(), body: body.trim(), categoryId: categoryId === "" ? null : categoryId, audience };
      const saved = article ? await kbArticleService.update(article.id, payload) : await kbArticleService.create(payload);
      showSuccessToast(article ? "Artículo guardado (vuelve a borrador)" : `Artículo ${saved.number} creado`);
      onSaved(saved.id);
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      size="lg"
      title={article ? `Editar ${article.number}` : "Nuevo artículo"}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Volver
          </Button>
          <Button type="button" loading={saving} disabled={title.trim().length < 5 || body.trim().length < 20} onClick={() => void save()}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {article?.status === "PUBLISHED" && (
          <p className="text-xs text-amber-700">Al guardar, el artículo vuelve a borrador y deja de verse hasta que se publique de nuevo.</p>
        )}
        <Field label="Título *" htmlFor="kb-title">
          <Input id="kb-title" maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Categoría" htmlFor="kb-category">
            <Select id="kb-category" value={categoryId === "" ? "" : String(categoryId)} onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : "")}>
              <option value="">Sin categoría</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Quién lo ve" htmlFor="kb-audience">
            <Select id="kb-audience" value={audience} onChange={(e) => setAudience(e.target.value as KbAudience)}>
              {(Object.keys(KB_AUDIENCE_LABELS) as KbAudience[]).map((value) => (
                <option key={value} value={value}>
                  {KB_AUDIENCE_LABELS[value]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Contenido * (texto plano; deje una línea en blanco entre párrafos)" htmlFor="kb-body">
          <Textarea id="kb-body" rows={14} maxLength={20000} value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

export function ArticleDetailView({
  id,
  onBack,
  onOpenProblem,
  categories,
}: {
  id: number;
  onBack: () => void;
  onOpenProblem: (id: number) => void;
  categories: ServiceCategory[];
}) {
  const navigate = useNavigate();
  const { can } = useAuth();
  const [article, setArticle] = useState<KbArticle | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  async function load(): Promise<void> {
    try {
      setArticle(await kbArticleService.getById(id));
    } catch (error) {
      setArticle(null);
      handleError(error, navigate);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function changeStatus(status: KbStatus, success: string): Promise<void> {
    setBusy(status);
    try {
      await kbArticleService.changeStatus(id, status);
      await load();
      showSuccessToast(success);
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <Loading />;
  if (!article) {
    return (
      <div>
        <BackButton onBack={onBack} />
        <EmptyState title="Artículo no encontrado" />
      </div>
    );
  }

  const canEdit = can("kb-articles:update") && article.status !== "RETIRED";
  const canApprove = can("kb-articles:approve");

  return (
    <div>
      <BackButton onBack={onBack} label="Volver a conocimiento" />
      <div className={`${CARD} mb-4`}>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold text-slate-800">{article.number}</h2>
          <Badge className={KB_STATUS_CLASSES[article.status]}>{KB_STATUS_LABELS[article.status]}</Badge>
          <Badge className="bg-slate-100 text-slate-700">{KB_AUDIENCE_LABELS[article.audience]}</Badge>
          {article.version > 0 && <Badge className="bg-slate-100 text-slate-700">v{article.version}</Badge>}
        </div>
        <p className="mt-2 font-medium text-slate-800">{article.title}</p>
        <p className="text-sm text-slate-600">
          Autor: {article.authorName ?? "-"} · {article.categoryName ?? "Sin categoría"} · Útil {article.helpfulYes} / No útil {article.helpfulNo} · {article.views} vistas
          {article.sourceProblemNumber && (
            <>
              {" "}
              · Origen{" "}
              <button type="button" className="text-brand-700 hover:underline" onClick={() => onOpenProblem(article.sourceProblemId!)}>
                {article.sourceProblemNumber}
              </button>
            </>
          )}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {canEdit && (
            <Button type="button" variant="secondary" onClick={() => setEditing(true)}>
              Editar
            </Button>
          )}
          {canEdit && article.status === "DRAFT" && (
            <Button type="button" variant="secondary" loading={busy === "IN_REVIEW"} onClick={() => void changeStatus("IN_REVIEW", "Enviado a revisión")}>
              Enviar a revisión
            </Button>
          )}
          {canApprove && (article.status === "DRAFT" || article.status === "IN_REVIEW") && (
            <Button type="button" variant="success" loading={busy === "PUBLISHED"} onClick={() => void changeStatus("PUBLISHED", "Artículo publicado")}>
              Publicar
            </Button>
          )}
          {canEdit && article.status === "IN_REVIEW" && (
            <Button type="button" variant="ghost" loading={busy === "DRAFT"} onClick={() => void changeStatus("DRAFT", "Devuelto a borrador")}>
              Devolver a borrador
            </Button>
          )}
          {canApprove && article.status !== "RETIRED" && (
            <Button
              type="button"
              variant="ghost"
              loading={busy === "RETIRED"}
              onClick={() => {
                if (window.confirm("¿Retirar el artículo? Dejará de mostrarse y no se puede volver a publicar.")) void changeStatus("RETIRED", "Artículo retirado");
              }}
            >
              Retirar
            </Button>
          )}
        </div>
      </div>
      <Section title="Contenido">
        <PlainText text={article.body} />
      </Section>
      {article.versions && article.versions.length > 0 && (
        <Section title="Versiones publicadas">
          <ul className="space-y-1 text-sm">
            {article.versions.map((version) => (
              <li key={version.version}>
                v{version.version} · {version.title} · {formatDateTime(version.publishedAt)}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {editing && (
        <ArticleFormModal
          article={article}
          categories={categories}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            void load();
          }}
        />
      )}
    </div>
  );
}
