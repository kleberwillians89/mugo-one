import {
  AlertTriangle,
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  Printer,
} from "lucide-react";
import type { OperationalShipment } from "../lib/records";
import { brl, shortDate } from "../lib/format";
import { operationalLabel } from "../lib/presentation";
import { getLabelUiState, shipmentHumanState } from "../lib/superfrete";

/**
 * Presentation-only mapping from shipment state to a specific "próximo
 * passo" label for the hero banner — never the generic "CONTINUAR
 * OPERAÇÃO". The button always opens the same editor (`onEdit`, unchanged);
 * this only chooses truthful copy for what the operator will find there.
 * When conference is still pending, the checklist is already visible right
 * below on the same page, so no button is shown at all (nothing to "open").
 */
function nextStep(shipment: OperationalShipment): { description: string; button: string | null } {
  const conferred =
    shipment.shipment_items.length > 0 &&
    shipment.shipment_items.every((i) => i.checked_at && !i.divergence_note);
  if (!conferred)
    return {
      description: "Separe e confira os itens abaixo antes de seguir para o frete.",
      button: null,
    };
  if (!shipment.selected_quote_id)
    return {
      description: "Informe o destinatário e calcule as opções de frete.",
      button: "CALCULAR FRETE",
    };
  if (shipment.status === "awaiting_customer_approval")
    return {
      description: "O frete foi selecionado e aguarda a aprovação da cliente.",
      button: "REVISAR FRETE",
    };
  const labelAction = getLabelUiState(shipment).primaryAction;
  if (labelAction === "checkout")
    return {
      description: "O pedido foi criado na SuperFrete; confirme a compra da etiqueta.",
      button: "CONFIRMAR COMPRA",
    };
  if (labelAction === "print")
    return { description: "O arquivo oficial está pronto para impressão.", button: "IMPRIMIR ETIQUETA" };
  if (labelAction === "sync")
    return { description: "A SuperFrete ainda está preparando o arquivo da etiqueta.", button: "ATUALIZAR ETIQUETA" };
  if (labelAction === "create_label")
    return { description: "Aprove o frete selecionado para liberar a etiqueta.", button: "CONFIRMAR FRETE" };
  return { description: "A operação atual está preservada. Continue pela ação indicada.", button: "REVISAR ENVIO" };
}

type Item = OperationalShipment["shipment_items"][number];
type Props = {
  shipment: OperationalShipment;
  items: Item[];
  onEdit: () => void;
  onSync: () => void;
  onCheckout: () => void;
  onPrint: () => void;
  onCopy: () => void;
  busy: string;
  feedback: string;
  isAdmin: boolean;
  onChange: (item: Item, kind: "separated" | "checked", value: boolean) => void;
  onDivergence: (item: Item, value: string) => void;
};

export function RuahBrand({ print = false }: { print?: boolean }) {
  return (
    <img
      className={`ruah-brand ${print ? "ruah-brand-print" : ""}`}
      src="/ruah-brand.svg"
      alt="RUAH Parfums"
    />
  );
}

const humanStatus = (s: OperationalShipment) => {
  const label = shipmentHumanState(s);
  if (label === "Preparando produtos" && s.selected_quote_id)
    return "Frete calculado";
  if (
    label === "Preparando produtos" &&
    s.shipment_items.every((i) => i.checked_at && !i.divergence_note)
  )
    return "Pronto para calcular frete";
  if (
    label === "Preparando produtos" &&
    s.shipment_items.some((i) => i.separated_at)
  )
    return "Aguardando conferência";
  return label;
};
const progressIndex = (s: OperationalShipment) =>
  s.status === "delivered"
    ? 7
    : s.status === "posted"
      ? 6
      : s.print_available
        ? 5
        : s.superfrete_order_id
          ? 5
          : s.status === "customer_approved"
            ? 4
            : s.status === "awaiting_customer_approval"
              ? 3
              : s.selected_quote_id
                ? 3
                : s.shipment_items.every(
                      (i) => i.checked_at && !i.divergence_note,
                    )
                  ? 2
                  : s.shipment_items.some((i) => i.separated_at)
                    ? 1
                    : 0;
const stages = [
  "Produtos",
  "Separação",
  "Conferência",
  "Frete",
  "Aprovação",
  "Etiqueta",
  "Postagem",
  "Entrega",
];
const weight = (kg: number | null) =>
  kg == null
    ? "—"
    : `${Math.round(Number(kg) * 1000).toLocaleString("pt-BR")} g`;

export function ShipmentStatus({
  shipment,
}: {
  shipment: OperationalShipment;
}) {
  return (
    <div className="shipment-status" role="status">
      <i />
      <div>
        <span>Status atual</span>
        <strong>{humanStatus(shipment)}</strong>
      </div>
    </div>
  );
}

export function ShipmentJourney({
  shipment,
}: {
  shipment: OperationalShipment;
}) {
  const active = progressIndex(shipment);
  return (
    <nav className="shipment-journey" aria-label="Progresso do envio">
      <div className="shipment-journey-compact" aria-hidden="true">
        <span>ETAPA {active + 1} DE {stages.length}</span>
        <strong>{stages[active]}</strong>
        <div className="shipment-journey-bar">
          <i style={{ width: `${((active + 1) / stages.length) * 100}%` }} />
        </div>
      </div>
      {stages.map((stage, index) => (
        <div
          key={stage}
          className={`${index < active ? "done" : ""} ${index === active ? "active" : ""}`}
        >
          <b>
            {index < active ? <Check /> : String(index + 1).padStart(2, "0")}
          </b>
          <span>{stage}</span>
        </div>
      ))}
    </nav>
  );
}

function SectionTitle({
  number,
  title,
  aside,
}: {
  number: string;
  title: string;
  aside?: string;
}) {
  return (
    <header className="shipment-section-title">
      <span>{number}</span>
      <div>
        <h2>{title}</h2>
        {aside && <p>{aside}</p>}
      </div>
    </header>
  );
}

export function ShipmentHeader({
  shipment,
  onEdit,
}: {
  shipment: OperationalShipment;
  onEdit: () => void;
}) {
  return (
    <>
      <header className="shipment-premium-head surface-dark">
        <RuahBrand />
        <div className="shipment-title">
          <span>ENVIO 360</span>
          <h1 data-surface-role="primary">{shipment.recipient_name}</h1>
          <p data-surface-role="secondary">
            Envio #{shipment.id.slice(0, 8).toUpperCase()} <i />{" "}
            {shortDate(shipment.created_at)}
          </p>
        </div>
        <ShipmentStatus shipment={shipment} />
      </header>
      <div className="next-action surface-accent">
        <div>
          <span>PRÓXIMO PASSO</span>
          <strong>{humanStatus(shipment)}</strong>
          <small>{nextStep(shipment).description}</small>
        </div>
        {nextStep(shipment).button && (
          <button className="primary" onClick={onEdit}>
            {nextStep(shipment).button} <ChevronRight />
          </button>
        )}
      </div>
    </>
  );
}

export function ShipmentChecklist({
  items,
  onChange,
  onDivergence,
}: {
  items: Item[];
  onChange: Props["onChange"];
  onDivergence: Props["onDivergence"];
}) {
  const separated = items.filter((i) => i.separated_at).length,
    checked = items.filter((i) => i.checked_at).length,
    pending = items.length - checked,
    divergent = items.filter((i) => i.divergence_note);
  return (
    <section className="shipment-editorial-section checklist-section">
      <SectionTitle
        number="01—02"
        title="Produtos · Separação e conferência"
        aside="Ordem alfabética para conferência física"
      />
      <div className="checklist-totals">
        <div>
          <strong>{items.length}</strong>
          <span>{items.length === 1 ? "item" : "itens"}</span>
        </div>
        <div>
          <strong>{separated}</strong>
          <span>{separated === 1 ? "separado" : "separados"}</span>
        </div>
        <div>
          <strong>{checked}</strong>
          <span>{checked === 1 ? "conferido" : "conferidos"}</span>
        </div>
        <div className={pending ? "pending" : ""}>
          <strong>{pending}</strong>
          <span>{pending === 1 ? "pendente" : "pendentes"}</span>
        </div>
      </div>
      {divergent.length > 0 && (
        <div className="divergence-callout">
          <AlertTriangle />
          <div>
            <strong>ATENÇÃO — CONFERÊNCIA NECESSÁRIA</strong>
            {divergent.map((i) => (
              <p key={i.allocation_id}>
                {i.sales?.perfume_name_raw || "Produto"}: {i.divergence_note}.
                Resolva antes de emitir a etiqueta.
              </p>
            ))}
          </div>
        </div>
      )}
      <div
        className="premium-checklist"
        role="table"
        aria-label="Produtos para conferência em ordem alfabética"
      >
        {items.map((item, index) => (
          <article key={item.allocation_id} role="row">
            <span className="item-number">
              {String(index + 1).padStart(2, "0")}
            </span>
            <div className="item-name">
              <strong>{item.sales?.perfume_name_raw || "Produto"}</strong>
              <span>
                {item.quantity_ml} ML ·{" "}
                {item.sales?.sale_type || "Tipo não informado"}
              </span>
            </div>
            <button
              className={`check-action ${item.separated_at ? "complete" : ""}`}
              aria-pressed={Boolean(item.separated_at)}
              onClick={() => onChange(item, "separated", !item.separated_at)}
            >
              {item.separated_at && <Check />}
              {item.separated_at ? "SEPARADO" : "MARCAR SEPARADO"}
            </button>
            <button
              className={`check-action ${item.checked_at ? "complete" : ""}`}
              aria-pressed={Boolean(item.checked_at)}
              onClick={() => onChange(item, "checked", !item.checked_at)}
            >
              {item.checked_at && <Check />}
              {item.checked_at ? "CONFERIDO" : "MARCAR CONFERIDO"}
            </button>
            <label className="divergence-select">
              <span>Divergência</span>
              <select
                aria-label={`Divergência de ${item.sales?.perfume_name_raw || "produto"}`}
                value={item.divergence_note || ""}
                onChange={(e) => onDivergence(item, e.target.value)}
              >
                <option value="">Sem divergência</option>
                {[
                  "Item faltando",
                  "Item extra",
                  "Perfume diferente",
                  "ML diferente",
                  "Quantidade diferente",
                  "Outro",
                ].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
          </article>
        ))}
      </div>
    </section>
  );
}

export function ShipmentFacts({
  shipment,
  onEdit,
}: {
  shipment: OperationalShipment;
  onEdit: () => void;
}) {
  return (
    <div className="shipment-facts">
      <section className="shipment-editorial-section">
        <SectionTitle number="03" title="Dados do destinatário" />
        <dl>
          <dt>Nome</dt>
          <dd>{shipment.recipient_name}</dd>
          <dt>Telefone</dt>
          <dd>{shipment.recipient_phone || "Não informado"}</dd>
          <dt>Documento</dt>
          <dd>{shipment.recipient_document || "Não informado"}</dd>
          <dt>CEP</dt>
          <dd>{shipment.recipient_postal_code || "Não informado"}</dd>
          <dt>Endereço</dt>
          <dd>
            {[
              shipment.recipient_address,
              shipment.recipient_number,
              shipment.recipient_complement,
            ]
              .filter(Boolean)
              .join(", ") || "Não informado"}
          </dd>
          <dt>Cidade / UF</dt>
          <dd>
            {[shipment.recipient_city, shipment.recipient_state]
              .filter(Boolean)
              .join(" / ") || "Não informado"}
          </dd>
        </dl>
      </section>
      <section className="shipment-editorial-section package-section">
        <SectionTitle number="04" title="Pacote e frete" />
        <div className="package-measure">
          <div>
            <span>Peso</span>
            <strong>{weight(shipment.package_weight)}</strong>
          </div>
          <div>
            <span>Dimensões</span>
            <strong>
              {shipment.package_length ?? "—"} × {shipment.package_width ?? "—"}{" "}
              × {shipment.package_height ?? "—"} cm
            </strong>
          </div>
        </div>
        <div className="freight-summary">
          <span>FRETE</span>
          {shipment.service ? (
            <>
              <h3>
                {shipment.carrier} · {shipment.service}
              </h3>
              <strong>
                {shipment.shipping_price == null
                  ? "Valor não informado"
                  : brl(Number(shipment.shipping_price))}
              </strong>
              <p>
                <Check /> Frete escolhido
              </p>
            </>
          ) : (
            <>
              <h3>Opções ainda não calculadas</h3>
              <p>Calcule os serviços disponíveis para este endereço.</p>
              <button onClick={onEdit}>CALCULAR FRETE</button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

export function ShipmentLabelCenter({
  shipment,
  onEdit,
  onSync,
  onCheckout,
  onPrint,
  onCopy,
  busy,
  feedback,
  isAdmin,
}: Pick<
  Props,
  | "shipment"
  | "onEdit"
  | "onSync"
  | "onCheckout"
  | "onPrint"
  | "onCopy"
  | "busy"
  | "feedback"
  | "isAdmin"
>) {
  const state = getLabelUiState(shipment),
    updated = shipment.print_checked_at || shipment.created_at,
    created = Boolean(shipment.superfrete_order_id),
    paid = ["released", "posted", "delivered"].includes(
      String(shipment.superfrete_status || "").toLowerCase(),
    ),
    prepared = state.canPrint;
  return (
    <section className="label-atelier surface-dark" aria-labelledby="label-center-title">
      <header className="label-atelier-head surface-dark">
        <RuahBrand />
        <div>
          <span>ETIQUETA DE ENVIO</span>
          <p>Envio #{shipment.id.slice(0, 8).toUpperCase()}</p>
          <h2 id="label-center-title" data-surface-role="primary">{shipment.recipient_name}</h2>
        </div>
        <strong>{state.title}</strong>
      </header>

      <div className="label-mini-journey" aria-label="Progresso da etiqueta">
        {[
          ["Etiqueta criada", created],
          ["Pagamento confirmado", paid],
          ["Arquivo preparado", prepared],
          ["Pronto para imprimir", prepared],
        ].map(([label, complete], index) => (
          <div
            className={complete ? "complete" : "current"}
            key={String(label)}
          >
            <i>{complete ? <Check /> : index + 1}</i>
            <span>{label}</span>
          </div>
        ))}
      </div>

      <div className="label-atelier-body">
        <div className="label-narrative">
          <span>SITUAÇÃO ATUAL</span>
          <h3>{state.title}</h3>
          <p>{state.description}</p>
          <div className="label-service-line">
            <div>
              <span>TRANSPORTADORA</span>
              <strong>
                {shipment.carrier || shipment.service || "A definir"}
              </strong>
              <small>{shipment.service || "Serviço selecionado"}</small>
            </div>
            <div>
              <span>VALOR DO FRETE</span>
              <strong>
                {shipment.shipping_price == null
                  ? "—"
                  : brl(Number(shipment.shipping_price))}
              </strong>
            </div>
          </div>
        </div>

        {shipment.tracking_code && (
          <aside className="tracking-vault">
            <span>CÓDIGO DE RASTREIO</span>
            <strong>{shipment.tracking_code}</strong>
            <button type="button" onClick={onCopy}>
              {feedback.startsWith("Código de rastreio copiado") ? (
                <Check />
              ) : (
                <Copy />
              )}
              {feedback.startsWith("Código de rastreio copiado")
                ? "CÓDIGO COPIADO"
                : "COPIAR CÓDIGO"}
            </button>
          </aside>
        )}
      </div>

      <div className="label-atelier-footer">
        <div className="label-file-state">
          <i className={prepared ? "ready" : "waiting"}>
            {prepared ? <Check /> : null}
          </i>
          <div>
            <span>ARQUIVO PARA IMPRESSÃO</span>
            <strong>
              {prepared
                ? "Pronto para imprimir"
                : "Sendo preparado pela SuperFrete"}
            </strong>
            <small>
              {prepared
                ? "O documento oficial está disponível."
                : "A impressão será liberada assim que o arquivo for concluído."}
            </small>
          </div>
        </div>

        {shipment.integration_error && (
          <div className="label-error">
            <AlertTriangle />
            <span>
              {shipment.integration_error === "SUPERFRETE_PRINT_UNAVAILABLE"
                ? "Etiqueta criada, mas o arquivo está temporariamente indisponível na SuperFrete."
                : "Não foi possível atualizar sua etiqueta agora. A etiqueta existente continua preservada."}
            </span>
          </div>
        )}
        {feedback && (
          <div className="label-feedback" role="status" aria-live="polite">
            <Check />
            <span>{feedback}</span>
          </div>
        )}
        <div className="label-premium-actions">
          {state.primaryAction === "checkout" && (
            <button
              type="button"
              className="primary"
              aria-busy={busy === "checkout"}
              disabled={!!busy}
              onClick={onCheckout}
            >
              {busy === "checkout"
                ? "CONFIRMANDO COMPRA…"
                : "CONFIRMAR COMPRA DA ETIQUETA"}
            </button>
          )}
          {state.primaryAction === "create_label" && (
            <button type="button" className="primary" onClick={onEdit}>
              CRIAR ETIQUETA
            </button>
          )}
          {state.canPrint && (
            <button type="button" className="label-primary" onClick={onPrint}>
              IMPRIMIR ETIQUETA <ExternalLink />
            </button>
          )}
          {state.canSync && (
            <button
              type="button"
              className={state.canPrint ? "label-secondary" : "label-primary"}
              aria-busy={busy === "sync"}
              disabled={!!busy}
              onClick={onSync}
            >
              {busy === "sync"
                ? "ATUALIZANDO…"
                : feedback.startsWith("Etiqueta atualizada")
                  ? "ATUALIZADO ✓"
                  : "ATUALIZAR ETIQUETA"}
            </button>
          )}
          {!state.canPrint && (
            <button
              type="button"
              className="label-disabled"
              disabled
              title={state.printUnavailableReason || undefined}
            >
              <Printer /> IMPRIMIR ETIQUETA
            </button>
          )}
          <button
            type="button"
            className="label-tertiary"
            onClick={() => window.print()}
          >
            <Printer /> IMPRIMIR FOLHA DO ENVIO
          </button>
        </div>
        <p className="label-updated">
          Última atualização ·{" "}
          {new Intl.DateTimeFormat("pt-BR", {
            dateStyle: "short",
            timeStyle: "short",
          }).format(new Date(updated))}
        </p>
        {isAdmin && (
          <details className="label-diagnostics">
            <summary>Detalhes técnicos</summary>
            <dl>
              <dt>Pedido</dt>
              <dd>
                …{shipment.superfrete_order_id?.slice(-6) || "não criado"}
              </dd>
              <dt>Status externo</dt>
              <dd>{shipment.superfrete_status || "não informado"}</dd>
              <dt>Checkout</dt>
              <dd>{shipment.checkout_status || "não iniciado"}</dd>
              <dt>Impressão</dt>
              <dd>
                {shipment.print_available ? "disponível" : "indisponível"}
              </dd>
              <dt>Rastreio</dt>
              <dd>{shipment.tracking_code ? "disponível" : "indisponível"}</dd>
            </dl>
          </details>
        )}
      </div>
    </section>
  );
}

export function ShipmentTimeline({
  shipment,
}: {
  shipment: OperationalShipment;
}) {
  return (
    <section className="shipment-editorial-section timeline-section">
      <SectionTitle number="07" title="Histórico do envio" />
      {shipment.shipment_events?.map((e) => (
        <div key={e.id}>
          <span>{shortDate(e.created_at)}</span>
          <strong>{operationalLabel(e.event_type)}</strong>
          <small>
            {operationalLabel(e.from_status || "Início")} →{" "}
            {operationalLabel(e.to_status || "Atual")}
          </small>
        </div>
      ))}
      {!shipment.shipment_events?.length && <p>Nenhum evento registrado.</p>}
    </section>
  );
}

export function ShipmentPrintView({
  shipment,
  items,
}: {
  shipment: OperationalShipment;
  items: Item[];
}) {
  const now = new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date());
  return (
    <section className="shipment-print-view">
      <RuahBrand print />
      <header>
        <span>FOLHA DO ENVIO</span>
        <h1>#{shipment.id.slice(0, 8).toUpperCase()}</h1>
        <h2>{shipment.recipient_name}</h2>
        <p>{shortDate(shipment.created_at)}</p>
      </header>
      <div className="print-summary">
        <h3>SEPARAÇÃO E CONFERÊNCIA</h3>
        <dl>
          <dt>Itens esperados</dt>
          <dd>{items.length}</dd>
          <dt>Separados</dt>
          <dd>{items.filter((i) => i.separated_at).length}</dd>
          <dt>Conferidos</dt>
          <dd>{items.filter((i) => i.checked_at).length}</dd>
          <dt>Divergências</dt>
          <dd>{items.filter((i) => i.divergence_note).length}</dd>
        </dl>
      </div>
      <table>
        <thead>
          <tr>
            <th>Nº</th>
            <th>Perfume</th>
            <th>ML</th>
            <th>Tipo</th>
            <th>Separado</th>
            <th>Conferido</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i, n) => (
            <tr key={i.allocation_id}>
              <td>{String(n + 1).padStart(2, "0")}</td>
              <td>{i.sales?.perfume_name_raw || "Produto"}</td>
              <td>{i.quantity_ml}</td>
              <td>{i.sales?.sale_type || "—"}</td>
              <td>{i.separated_at ? "✓" : "○"}</td>
              <td>{i.checked_at ? "✓" : "○"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="print-signatures">
        <span>Separado por:</span>
        <span>Conferido por:</span>
      </div>
      <footer>
        RUAH Intelligence · Operação logística <small>Impresso em {now}</small>
      </footer>
    </section>
  );
}

export function Shipment360View(props: Props) {
  return (
    <>
      <div className="shipment-screen">
        <ShipmentHeader shipment={props.shipment} onEdit={props.onEdit} />
        <ShipmentJourney shipment={props.shipment} />
        <ShipmentChecklist
          items={props.items}
          onChange={props.onChange}
          onDivergence={props.onDivergence}
        />
        <ShipmentFacts shipment={props.shipment} onEdit={props.onEdit} />
        <ShipmentLabelCenter
          shipment={props.shipment}
          onEdit={props.onEdit}
          onSync={props.onSync}
          onCheckout={props.onCheckout}
          onPrint={props.onPrint}
          onCopy={props.onCopy}
          busy={props.busy}
          feedback={props.feedback}
          isAdmin={props.isAdmin}
        />
        <ShipmentTimeline shipment={props.shipment} />
      </div>
      <ShipmentPrintView shipment={props.shipment} items={props.items} />
    </>
  );
}
