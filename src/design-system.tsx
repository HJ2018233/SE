import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import type { PropsWithChildren } from "react";

/** Shared Fluent 2 context for all roles and viewport sizes. */
export function DesignSystemProvider({ children }: PropsWithChildren) {
  return (
    <FluentProvider theme={webLightTheme} lang="zh-CN">
      {children}
    </FluentProvider>
  );
}
