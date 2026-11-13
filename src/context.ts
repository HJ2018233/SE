import { createContext, useContext } from "react";
import type { Conditions, DemoData, Role, Scenario } from "./model";

export type AppState = {
  data: DemoData;
  update: (fn: (data: DemoData) => DemoData) => void;
  audit: (
    action: string,
    object: string,
    detail: string,
    result?: string,
  ) => void;
  role: Role;
  signedIn: boolean;
  signIn: () => void;
  signOut: () => void;
  go: (path: string) => void;
  path: string;
  conditions: Conditions;
  setConditions: (conditions: Conditions) => void;
  scenario: Scenario;
  setScenario: (scenario: Scenario) => void;
  notify: (
    text: string,
    intent?: "success" | "error" | "warning" | "info",
  ) => void;
};
export const AppContext = createContext<AppState | null>(null);
export function useApp() {
  const value = useContext(AppContext);
  if (!value) throw new Error("AppContext is required");
  return value;
}
