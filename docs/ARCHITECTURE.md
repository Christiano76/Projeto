# AI Agency OS — Arquitetura

> Estado: **Fase 1 (Fundação) implementada.** As seções marcadas com _(Fase N)_ descrevem o que está planejado e já tem estrutura de dados pronta.

## 1. Análise do ambiente inicial

O repositório estava vazio (sem commits). Não havia tecnologias pré-existentes a respeitar, então a stack segue o pedido: Next.js + React + TypeScript + Tailwind, Three.js/React Three Fiber/Drei, Node.js, Supabase/PostgreSQL, Claude API (com OpenAI como alternativa).

Versões escolhidas por estabilidade: Next.js 15.5, React 19.2, R3F 9, Drei 10, three r181, Tailwind 4, Zod 4, Vitest 3, TypeScript 5.9.

## 2. Princípio central

**O escritório 3D é uma projeção dos eventos reais do backend — nunca o contrário.**

```
 agente / orquestrador / diretor
              │  (entrada de evento)
              ▼
   ingestEvent()  ── valida (Zod) ── aplica máquina de estados (pura)
              │                         │ transição inválida → rejeita (nada muda)
              ▼                         ▼
   commit atômico: agent_events (append-only) + employees.runtime_state
              │
              ├── Supabase Realtime (produção)  ┐
              └── SSE /api/events/stream (local) ┴─► store do navegador
                                                       │
                                     deriveActivity() + allocateAnchors()
                                                       │
                                     avatar caminha (A*) e anima a pose
```

- Um avatar só "digita" se o status for `working` **com** uma tarefa atual; a tela do monitor só acende nesse caso.
- "Comemorar" é um efeito de 4 s derivado de um `task.completed` real, não um status inventado.
- Eventos fora de ordem ou incoerentes (ex.: concluir uma tarefa que não é a atual) são recusados e **não** são persistidos.

## 3. Estrutura de pastas

```
.
├── apps/
│   └── web/                      Next.js (UI + API + 3D)
│       └── src/
│           ├── app/              rotas (App Router)
│           │   ├── page.tsx              escritório 3D (tela inicial)
│           │   ├── admin/                painel administrativo
│           │   ├── login/, onboarding/   Supabase Auth + criação da empresa
│           │   └── api/                  office, events, events/stream, company/bootstrap, health
│           ├── components/
│           │   ├── office/       cena 3D: câmera, estrutura, móveis instanciados, avatares, rótulos
│           │   ├── hud/          barra superior, navegação, ficha do funcionário, feed
│           │   └── EventConsole.tsx      console de eventos manuais (diretor)
│           ├── lib/              env (server-only), clientes Supabase, assinatura em tempo real
│           ├── server/           auth, ingestão de eventos, repositórios (memória/Supabase)
│           ├── store/            Zustand (estado do escritório no navegador)
│           └── middleware.ts     sessão Supabase + proteção de rotas
├── packages/
│   └── core/                     domínio compartilhado (sem dependência de UI ou banco)
│       └── src/
│           ├── domain/           tipos: funcionário, estado, snapshot
│           ├── events/           catálogo + validação de eventos (Zod)
│           ├── state/            máquina de estados + derivação visual + alocação de assentos
│           ├── office/           layout, paredes, âncoras, grade de navegação e A*
│           └── seed/             empresa padrão (departamentos, equipe, escritório)
├── supabase/
│   ├── migrations/               esquema completo + RLS + função de commit
│   └── test/                     testes das migrações (PGlite)
├── scripts/e2e-smoke.mjs         teste ponta a ponta com Chromium
└── docs/
```

Planejado: `apps/worker` _(Fase 3)_ — processo Node.js independente do navegador que roda o orquestrador, consome a fila `tasks` e chama os modelos de IA, reutilizando `@agency/core` e `ingestEvent`.

## 4. Camadas

| Camada | Responsabilidade | Onde |
| --- | --- | --- |
| Domínio | Regras puras: eventos, transições, layout, navegação | `packages/core` |
| Aplicação | Casos de uso (`ingestEvent`, bootstrap) | `apps/web/src/server` |
| Persistência | Porta `Repository` com 2 adaptadores (memória, Supabase) | `server/repository` |
| Entrega | API REST, SSE, páginas | `app/api`, `app/*` |
| Apresentação | Escritório 3D + HUD + painel | `components`, `store` |
| Execução autônoma _(Fase 3)_ | Orquestrador, filas, chamadas de IA | `apps/worker` |

O domínio é compartilhado, então o worker, a API e o navegador aplicam **exatamente** as mesmas regras.

## 5. Fluxo de dados 3D ⇄ backend

1. **Carga inicial**: a página `/` (Server Component) autentica, carrega o `OfficeSnapshot` (layout, departamentos, funcionários com `runtime_state`, 50 eventos recentes) e o entrega ao cliente.
2. **Tempo real**: o cliente assina mudanças.
   - Supabase: `postgres_changes` em `agent_events` (INSERT) e `employees` (UPDATE), filtrado por `company_id` e protegido por RLS.
   - Modo local: `EventSource('/api/events/stream')`.
3. **Reconexão**: ao voltar a ficar "ao vivo", o cliente refaz o snapshot para recuperar eventos perdidos. Atualizações antigas são descartadas por `runtime.version`.
4. **Derivação visual (cliente)**: `deriveActivity(state, now)` → posicionamento (mesa, reunião, descanso, fora), pose, tela do monitor, selo. `allocateAnchors` atribui assentos de forma determinística (todos os navegadores concordam).
5. **Movimento**: a grade de navegação é gerada a partir das paredes/portas/móveis; o A* (8 direções, sem cortar quinas, suavização por linha de visão) leva o avatar ao destino.
6. **Escrita**: somente pelo servidor. O navegador nunca grava estado; o diretor envia comandos à API, que valida, autoriza e usa a service role.

Sem polling: o 3D só reage a eventos. O relógio do cliente só dispara um re-render quando uma atividade derivada expira (fim da comemoração).

## 6. Banco de dados (Supabase/PostgreSQL)

Migração: `supabase/migrations/20261106000000_initial_schema.sql`.

```
companies 1─┬─* users (perfil do auth.users; papel director/member)
            ├─1 company_settings (limites de autonomia, orçamento, permissões externas)
            ├─* departments ─┬─* employees ─┬─1 agents ─* agent_instructions (versionadas)
            │                │              ├─1 employee_positions ─► office_objects (mesa)
            │                │              ├─* agent_events  (append-only; fonte da verdade do 3D)
            │                │              └─* agent_messages
            ├─* office_rooms ─* office_objects          (escritório expansível por dados)
            ├─* tasks ─* task_logs ; tasks ─* agent_runs (tokens, custo)
            ├─* customers ─* opportunities ─* proposals ─* projects ─* invoices
            └─* expenses (pode referenciar agent_runs → custo de IA)
```

Decisões:
- **Multi-tenant** por `company_id` em todas as tabelas, com índices compostos `(company_id, …)`.
- **RLS**: membros leem dados da própria empresa; o diretor escreve configuração (salas, móveis, funcionários, agentes); dados operacionais (eventos, tarefas, execuções, CRM) só são escritos pelo backend com a service role.
- `commit_agent_event(...)`: grava evento + novo estado numa transação, com **concorrência otimista** (`state_version`). Executável apenas pela service role.
- Restrições de negócio no banco: oportunidade exige `source_url` http(s) e `evidence` (não inventar clientes); projeto não pode ter `production_url` sem `publish_approved_by`.
- `tasks_queue_idx` (parcial, `status = 'queued'`) prepara a fila da Fase 3 (`FOR UPDATE SKIP LOCKED` + `locked_until`).
- Realtime habilitado só para `agent_events` e `employees`.

## 7. Autonomia dos agentes _(Fases 2–3)_

Planejamento já refletido no esquema:

- **Agente** = funcionário + `agents` (provedor, modelo, temperatura, limites de tokens/execuções, ferramentas permitidas, `enabled`) + `agent_instructions` (prompt versionado).
- **Abstração de provedor**: interface `LlmProvider` (`complete`, `countTokens`, custo por modelo) com adaptadores Anthropic e OpenAI; seleção por linha de `agents`.
- **Orquestrador (worker)**: ciclo planejar → distribuir → executar → comunicar → verificar → concluir → aprender → replanejar. Cada passo é uma tarefa na fila; nada de laços de IA sem fim:
  - `company_settings.max_concurrent_tasks`, `max_ai_calls_per_hour`, `monthly_ai_budget_usd`, `max_task_attempts`, `cycle_pause_seconds`.
  - Orçamento verificado **antes** de cada chamada (soma de `agent_runs.cost_usd` do mês).
  - Tentativas com backoff exponencial; tarefa vai a `failed` após `max_attempts`.
- **Ferramentas**: lista branca por agente; ações externas (enviar mensagem, enviar proposta, publicar, gastar) exigem a permissão correspondente em `external_permissions` **e** aprovação do diretor (status `pending_approval` → `task.blocked` no 3D).
- Cada transição emite eventos via `ingestEvent` — o mesmo caminho validado pela Fase 1.

## 8. Segurança

- Segredos só no servidor (`lib/env.ts` e `lib/supabase/server.ts` importam `server-only`). Nada de `NEXT_PUBLIC_` para service role ou chaves de IA.
- Toda rota de API autentica (`requireViewer`) e escritas exigem papel de diretor.
- Entrada validada com Zod (limites de tamanho, `strict` contra campos extras).
- Consultas com service role sempre filtradas por `company_id` do usuário autenticado; IDs não-UUID são rejeitados antes de chegar ao banco.
- Erros internos não vazam detalhes ao cliente.
- Cabeçalhos: `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`.
- _(Fase 5)_ Código gerado pelos agentes roda apenas em sandbox isolada (container efêmero por projeto, sem segredos, rede restrita), nunca no servidor da aplicação.

## 9. Performance do 3D

- Móveis: **instanciamento** por (tipo × peça) — o número de draw calls não cresce com a quantidade de móveis.
- Geometrias e materiais compartilhados (cache), `flatShading` low-poly, sem texturas.
- Cena carregada sob demanda (`next/dynamic`, `ssr: false`) — HUD e dados aparecem antes.
- Animação procedural em refs (sem re-render do React por quadro); avatares fora do frustum não animam membros.
- `PerformanceMonitor` reduz DPR, desliga antialias e sombras em máquinas modestas.
- Rótulos: uma única camada DOM projetada por quadro (em vez de um portal React por rótulo).

## 10. Assets 3D (Blender)

Os modelos atuais são procedurais (peças em `components/office/models.ts`), o que mantém o bundle mínimo e permite iterar sem arquivos binários. Para usar modelos do Blender: exportar `.glb` (Draco, ≤ 5k triângulos por móvel, origem no centro da base, frente para +Z, 1 unidade = 1 m) em `apps/web/public/models/<tipo>.glb` e trocar o renderizador do tipo por um `useGLTF` + `<Instances>`. Avatares: rig simples com as mesmas articulações (quadril, joelho, ombro, pescoço) para reaproveitar `animatePose`.

## 11. Riscos e dependências

| Risco | Mitigação |
| --- | --- |
| Custos de IA descontrolados | Orçamento mensal + limites por hora/agente verificados antes de cada chamada; agentes desligados por padrão |
| Laços autônomos infinitos | Ciclos guiados por fila, com pausas, limites de tentativas e de tarefas simultâneas |
| Prospecção violar LGPD/termos | Somente fontes públicas e permitidas, evidência + URL obrigatórias, sem raspagem de dados pessoais, sem envio automático |
| Ações externas indevidas | Permissões explícitas + aprovação humana; publicação bloqueada no banco sem aprovação |
| Execução de código gerado | Sandbox isolada por projeto _(Fase 5)_ |
| Divergência visual × backend | Estado só muda por eventos validados; cliente deriva, não inventa; ressincronização ao reconectar |
| Desempenho em celulares | Instanciamento, qualidade adaptativa, sem texturas |
| Dependências externas | Supabase (Auth, Postgres, Realtime), Anthropic/OpenAI; o modo local permite desenvolver sem nenhuma delas |
