# AI Agency OS

Empresa virtual em 3D (isométrica, low-poly) cujos funcionários são agentes de IA. O escritório é a representação visual do que acontece de fato no backend.

- Arquitetura: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Relatório da Fase 1: [`docs/FASE-1.md`](docs/FASE-1.md)

## Requisitos

- Node.js ≥ 20.9 (testado com 22)
- npm 10+
- (opcional) Projeto no [Supabase](https://supabase.com) e Supabase CLI

## Início rápido (modo local, sem credenciais)

```bash
npm install
npm run dev            # http://localhost:3000
```

Sem variáveis do Supabase, o app roda em **modo local**: os dados ficam em memória no processo do servidor (são perdidos ao reiniciar) e não há login. Um selo "modo local" aparece na barra superior.

## Configurando o Supabase

1. Crie um projeto no Supabase.
2. Aplique a migração:
   ```bash
   npx supabase login
   npx supabase link --project-ref <SEU_PROJECT_REF>
   npx supabase db push          # aplica supabase/migrations/*
   ```
   (Alternativa: cole o conteúdo de `supabase/migrations/20261106000000_initial_schema.sql` no SQL Editor.)
3. Em **Database → Replication**, confirme que `agent_events` e `employees` estão na publicação `supabase_realtime` (a migração já tenta adicioná-las).
4. Copie as variáveis:
   ```bash
   cp apps/web/.env.example apps/web/.env.local
   ```
   Preencha `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` (Project Settings → API).
   **Nunca** coloque a service role em variáveis `NEXT_PUBLIC_*`.
5. `npm run dev`, acesse `/login`, crie a conta e depois a empresa (você será o diretor).

## Scripts

| Comando | O que faz |
| --- | --- |
| `npm run dev` | servidor de desenvolvimento |
| `npm run build` / `npm start` | build e execução de produção |
| `npm run typecheck` | TypeScript em `core` e `web` |
| `npm test` | testes unitários, de integração e das migrações (PGlite) |
| `npm run test:e2e` | teste ponta a ponta no Chromium (requer `npm run build` antes) |

## Controles do escritório

- **Arrastar**: mover a câmera · **botão direito / dois dedos**: girar · **roda / pinça**: zoom
- **⟲ ⟳**: girar 90° · **Visão geral**: enquadrar tudo · **duplo clique numa sala** ou lista lateral: enquadrar a sala
- **Clique num funcionário**: abre a ficha (estado real, tarefa, histórico, produtividade)
- **Paredes**: alterna paredes baixas (corte) e altas

Até os agentes de IA serem ativados (Fase 2), o diretor pode registrar eventos pelo **console de eventos manuais** (na ficha do funcionário ou em `/admin/events`). Eles ficam marcados como `manual` e passam pelas mesmas regras de transição.
