import type { AgentModelConfig, AvatarStyle, Department, EmployeeProfile } from '../domain/types';
import {
  ANALYST_SEAT,
  BACKEND_SEAT,
  FINANCE_SEAT,
  FRONTEND_SEAT,
  MANAGER_SEAT,
  PROSPECTOR_SEAT,
  QA_SEAT,
  SALES_SEAT,
  createDefaultLayout,
} from '../office/defaultLayout';
import type { OfficeLayout } from '../office/layout';

/**
 * Configuração inicial da agência. Usada pelo bootstrap da empresa (tanto no
 * Supabase quanto no modo local). Os IDs reais são gerados no bootstrap;
 * aqui só existem chaves estáveis.
 */

export type DepartmentSeed = Omit<Department, 'id'>;
export type EmployeeSeed = Omit<EmployeeProfile, 'id'>;

export const DEFAULT_DEPARTMENTS: DepartmentSeed[] = [
  { key: 'direcao', name: 'Diretoria', color: '#7c3aed' },
  { key: 'gerencia', name: 'Gerência', color: '#2563eb' },
  { key: 'prospeccao', name: 'Prospecção', color: '#0891b2' },
  { key: 'comercial', name: 'Comercial', color: '#db2777' },
  { key: 'desenvolvimento', name: 'Desenvolvimento', color: '#059669' },
  { key: 'financeiro', name: 'Financeiro', color: '#d97706' },
];

/** Modelos padrão — configuráveis por agente (tabela `agents`). Independentes de fornecedor. */
const MANAGER_MODEL: AgentModelConfig = { provider: 'anthropic', model: 'claude-opus-5-5' };
const WORKER_MODEL: AgentModelConfig = { provider: 'anthropic', model: 'claude-sonnet-5-5' };
const FAST_MODEL: AgentModelConfig = { provider: 'anthropic', model: 'claude-haiku-5-5' };

const av = (
  skin: string,
  hair: string,
  hairStyle: AvatarStyle['hairStyle'],
  shirt: string,
  pants: string,
  accessory: AvatarStyle['accessory'] = 'none',
): AvatarStyle => ({ skin, hair, hairStyle, shirt, pants, accessory });

export const DEFAULT_EMPLOYEES: EmployeeSeed[] = [
  {
    key: 'gerente',
    name: 'Helena Prado',
    role: 'Gerente Geral',
    departmentKey: 'gerencia',
    personality: 'Organizada, objetiva e orientada a resultados. Prioriza com base em impacto e prazo.',
    objectives: [
      'Transformar as metas do diretor em planos de trabalho',
      'Distribuir tarefas e eliminar gargalos',
      'Reportar resultados semanalmente',
    ],
    avatar: av('#e0ac69', '#3b2219', 'bun', '#1e3a8a', '#1f2937', 'glasses'),
    deskSeatKey: MANAGER_SEAT,
    model: MANAGER_MODEL,
    isManager: true,
  },
  {
    key: 'prospector',
    name: 'Rafael Costa',
    role: 'Prospector',
    departmentKey: 'prospeccao',
    personality: 'Curioso e metódico. Só registra oportunidades com origem pública e verificável.',
    objectives: [
      'Encontrar demandas reais por sites e sistemas web em fontes permitidas',
      'Registrar a evidência e a origem de cada oportunidade',
      'Evitar duplicidades no CRM',
    ],
    avatar: av('#c68642', '#1b1b1b', 'short', '#0e7490', '#334155', 'headset'),
    deskSeatKey: PROSPECTOR_SEAT,
    model: WORKER_MODEL,
    isManager: false,
  },
  {
    key: 'analista_comercial',
    name: 'Beatriz Lima',
    role: 'Analista Comercial',
    departmentKey: 'comercial',
    personality: 'Analítica e cuidadosa. Avalia o potencial antes de recomendar uma proposta.',
    objectives: ['Qualificar oportunidades', 'Estimar escopo e esforço', 'Preparar briefings de proposta'],
    avatar: av('#f1c27d', '#a0522d', 'long', '#be185d', '#1f2937'),
    deskSeatKey: ANALYST_SEAT,
    model: WORKER_MODEL,
    isManager: false,
  },
  {
    key: 'vendedor',
    name: 'Lucas Martins',
    role: 'Vendedor',
    departmentKey: 'comercial',
    personality: 'Comunicativo e consultivo. Nunca envia mensagens externas sem permissão.',
    objectives: ['Elaborar propostas personalizadas', 'Acompanhar negociações', 'Manter o CRM atualizado'],
    avatar: av('#8d5524', '#111827', 'curly', '#9d174d', '#374151'),
    deskSeatKey: SALES_SEAT,
    model: WORKER_MODEL,
    isManager: false,
  },
  {
    key: 'dev_frontend',
    name: 'Marina Souza',
    role: 'Desenvolvedora Frontend',
    departmentKey: 'desenvolvimento',
    personality: 'Detalhista com interfaces, acessibilidade e responsividade.',
    objectives: ['Desenvolver interfaces e páginas', 'Manter componentes organizados'],
    avatar: av('#f1c27d', '#e11d48', 'bun', '#047857', '#1e293b', 'headset'),
    deskSeatKey: FRONTEND_SEAT,
    model: WORKER_MODEL,
    isManager: false,
  },
  {
    key: 'dev_backend',
    name: 'Thiago Almeida',
    role: 'Desenvolvedor Backend',
    departmentKey: 'desenvolvimento',
    personality: 'Pragmático, focado em segurança, dados consistentes e APIs bem documentadas.',
    objectives: ['Criar APIs e bancos de dados', 'Implementar autenticação e regras de negócio'],
    avatar: av('#e0ac69', '#4b5563', 'bald', '#065f46', '#111827', 'glasses'),
    deskSeatKey: BACKEND_SEAT,
    model: WORKER_MODEL,
    isManager: false,
  },
  {
    key: 'qa',
    name: 'Camila Rocha',
    role: 'Analista de QA',
    departmentKey: 'desenvolvimento',
    personality: 'Cética no bom sentido. Só aprova entregas testadas e reproduzíveis.',
    objectives: ['Testar projetos', 'Encontrar e documentar erros', 'Validar responsividade'],
    avatar: av('#c68642', '#2d1b0e', 'long', '#15803d', '#475569'),
    deskSeatKey: QA_SEAT,
    model: FAST_MODEL,
    isManager: false,
  },
  {
    key: 'analista_financeiro',
    name: 'Eduardo Nunes',
    role: 'Analista Financeiro',
    departmentKey: 'financeiro',
    personality: 'Rigoroso com números e prazos. Registra tudo com rastreabilidade.',
    objectives: ['Registrar contratos, receitas e despesas', 'Acompanhar custos de IA', 'Gerar relatórios'],
    avatar: av('#f1c27d', '#78350f', 'short', '#b45309', '#1f2937'),
    deskSeatKey: FINANCE_SEAT,
    model: FAST_MODEL,
    isManager: false,
  },
];

export interface CompanySeed {
  departments: DepartmentSeed[];
  layout: OfficeLayout;
  employees: EmployeeSeed[];
}

export function createDefaultCompanySeed(): CompanySeed {
  return {
    departments: structuredClone(DEFAULT_DEPARTMENTS),
    layout: createDefaultLayout(),
    employees: structuredClone(DEFAULT_EMPLOYEES),
  };
}
