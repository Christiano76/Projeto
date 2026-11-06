# Fase 1 — Fundação: relatório

## O que foi implementado

| Item pedido | Implementação |
| --- | --- |
| Estrutura do projeto | Monorepo npm workspaces: `apps/web` (Next.js), `packages/core` (domínio), `supabase/` (migrações) |
| Banco de dados | Esquema completo das 20 tabelas pedidas + `companies`, com relacionamentos, índices, RLS, gatilho de criação de perfil, função atômica `commit_agent_event` e publicação Realtime |
| Autenticação | Supabase Auth (e-mail/senha) com `@supabase/ssr`, middleware de sessão, papéis `director`/`member`, criação da empresa no primeiro acesso (onboarding) |
| Escritório 3D | Cena isométrica ortográfica, low-poly, sombras suaves, câmera com zoom, pan, rotação controlada (azimute + passos de 90°), enquadramento automático e por sala |
| Salas | 9 ambientes (recepção, diretor, gerente, comercial, prospecção, desenvolvimento, financeiro, reuniões, descanso) + corredor, todos com móveis, mesas, cadeiras, computadores e decoração; layout armazenado como dados (expansível) |
| Personagens | 8 funcionários com nome, cargo, departamento, personalidade, avatar próprio, mesa, computador, modelo de IA, objetivos, histórico, produtividade e status |
| Movimentação | Grade de navegação gerada da planta + A* com suavização; avatares caminham entre mesa, sala de reuniões, área de descanso e entrada |
| Sistema de estados | Catálogo de 13 eventos validados (Zod), máquina de estados pura com 7 status, derivação visual e alocação determinística de assentos, persistência atômica com concorrência otimista, tempo real (Supabase Realtime / SSE) |
| Painel administrativo | `/admin` (KPIs, status da equipe, produtividade, funcionários, eventos) e `/admin/events` (log + console manual) |

### Animações (todas ligadas ao estado real)

| Estado real | Onde o avatar fica | Animação | Monitor |
| --- | --- | --- | --- |
| `idle` | própria mesa | sentado, olhando em volta | apagado |
| `working` | própria mesa | digitando | aceso |
| `blocked` | própria mesa | sentado, selo laranja "!" | aceso (laranja) |
| `error` | própria mesa | sentado, selo vermelho "!" | apagado |
| `meeting` | sala de reuniões | conversando | apagado |
| `resting` | área de descanso | relaxando | apagado |
| `offline` | sai pela recepção e some | caminhando | apagado |
| após `task.completed` real | própria mesa | comemora por 4 s, estrela | apagado |

Toda mudança de destino gera uma caminhada real pela planta. Hoje todos começam como "Disponível": não há trabalho simulado.

## Arquivos criados

```
package.json, tsconfig.base.json, vitest.config.ts, .gitignore, README.md
docs/ARCHITECTURE.md, docs/FASE-1.md
scripts/e2e-smoke.mjs, scripts/test-stubs/empty.ts

packages/core/
  src/index.ts
  src/domain/types.ts, src/domain/snapshot.ts
  src/events/schema.ts
  src/state/employeeState.ts, src/state/activity.ts
  src/office/layout.ts, anchors.ts, walls.ts, navigation.ts, defaultLayout.ts
  src/seed/defaultCompany.ts
  test/events.test.ts, employeeState.test.ts, activity.test.ts, office.test.ts, helpers.ts

supabase/
  migrations/20261106000000_initial_schema.sql
  test/migrations.test.ts

apps/web/
  package.json, next.config.ts, tsconfig.json, postcss.config.mjs, .env.example, next-env.d.ts
  src/middleware.ts
  src/app/layout.tsx, page.tsx, globals.css
  src/app/login/{page.tsx, LoginForm.tsx}
  src/app/onboarding/{page.tsx, OnboardingForm.tsx}
  src/app/admin/{layout.tsx, page.tsx}, admin/events/{page.tsx, ManualConsole.tsx}
  src/app/auth/signout/route.ts
  src/app/api/{health, office, events, events/stream, company/bootstrap}/route.ts
  src/components/OfficeApp.tsx, EventConsole.tsx
  src/components/office/{OfficeScene, CameraRig, Structure, Furniture, Avatar}.tsx, models.ts, geometry.ts, labels.tsx
  src/components/hud/{TopBar, SidePanel, EmployeePanel, EventFeed, LabelLayer}.tsx
  src/lib/{env, publicEnv, format, liveUpdates}.ts, lib/supabase/{browser, server}.ts
  src/server/{auth, events, http}.ts, server/events.test.ts
  src/server/repository/{index, types, memory, supabase}.ts
  src/store/officeStore.ts
```

## Como executar

```bash
npm install
npm run dev                 # modo local em http://localhost:3000
```

Supabase: ver [README](../README.md#configurando-o-supabase).

## Testes realizados

```bash
npm run typecheck           # OK
npm test                    # 51 testes, 6 arquivos — todos passando
npm run build && npm run test:e2e   # 18 verificações em Chromium — todas passando
```

| Suíte | Cobertura |
| --- | --- |
| `core/events` | validação de eventos, limites de tamanho, campos extras, tipos desconhecidos |
| `core/employeeState` | todas as transições, rejeições (tarefa simultânea, tarefa errada, fora de ordem, offline), replay |
| `core/activity` | só "digita" quando trabalhando, janela de comemoração, alocação determinística de assentos, transbordo de reunião |
| `core/office` | 9 salas, sem sobreposição de salas/móveis, objetos dentro das salas, mesa única por funcionário, portas nas paredes compartilhadas, **todos os assentos alcançáveis a partir da entrada**, caminho bloqueado sem porta |
| `server/events` | bootstrap, ingestão, rejeição sem persistência, isolamento entre empresas, retentativa em conflito, ordem monotônica, ciclo completo |
| `supabase/migrations` | aplica o esquema em PostgreSQL (PGlite), gatilho de perfil, **isolamento RLS entre empresas**, membro não altera configuração, cliente não grava eventos nem chama a função de commit, usuário não se promove, concorrência otimista, restrições de oportunidade/publicação, publicação Realtime |
| `e2e-smoke` | WebGL renderiza, 9 salas e 8 funcionários, estados iniciais honestos, API aceita/recusa transições (201/409/400), atualização chega ao navegador por SSE, ficha mostra a tarefa real, produtividade, mobile sem rolagem horizontal, painel admin, console sem erros |

Capturas geradas pelo E2E ficam em `artifacts/` (ignorado no git).

## Limitações conhecidas

- O fluxo com Supabase real (login, Realtime, `db push`) **não foi executado contra um projeto Supabase** neste ambiente, por falta de credenciais. O esquema e o RLS foram validados em PostgreSQL via PGlite; o adaptador `SupabaseRepository` foi verificado só por tipos.
- Modelos 3D são procedurais (primitivas low-poly), não arquivos do Blender — a troca está documentada em ARCHITECTURE.md §10.
- Avatares não desviam uns dos outros (podem se sobrepor ao cruzar).
- O modo local mantém dados em memória de um único processo (não serve para produção nem para múltiplas instâncias).
- Não há ESLint configurado; a verificação estática é o `tsc` em modo estrito.

## O que falta (próximas fases)

- **Fase 2 — Funcionários**: interface de provedor de IA (Anthropic/OpenAI), ativação dos agentes, instruções versionadas, tarefas (`tasks`/`task_logs`), comunicação interna (`agent_messages`), histórico de execuções e custos (`agent_runs`).
- **Fase 3 — Autonomia**: `apps/worker`, orquestrador e ciclo do gerente, fila com `SKIP LOCKED`, limites de orçamento/chamadas/concorrência, monitoramento.
- **Fase 4 — Comercial**: CRM, prospecção em fontes permitidas com evidência, qualificação, propostas com PDF e aprovação.
- **Fase 5 — Produção**: projetos com repositório isolado e sandbox, testes, entrega com aprovação de publicação.
- **Fase 6 — Expansão**: editor de escritório, novos departamentos/salas/funcionários, relatórios avançados.

A Fase 2 depende da validação desta fase (em especial, conectar um projeto Supabase e confirmar login + Realtime) e das chaves de API de IA.
