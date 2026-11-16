export interface DagTaskDef {
  id: string;
  description: string;
  dependsOn: string[];
}

export interface DagPlan {
  goal: string;
  provider: string;
  tasks: DagTaskDef[];
}

export type DagNodeStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';
