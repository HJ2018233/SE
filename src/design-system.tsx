import { createLightTheme, FluentProvider } from "@fluentui/react-components";
import type { BrandVariants, Theme } from "@fluentui/react-components";
import type { PropsWithChildren } from "react";

const brandRamp: BrandVariants = {
  10: "#04181E",
  20: "#08242D",
  30: "#0C333F",
  40: "#0F4252",
  50: "#114F62",
  60: "#13586D",
  70: "#145F76",
  80: "#176A84",
  90: "#247D99",
  100: "#3791AC",
  110: "#4FA5BF",
  120: "#6DB9D0",
  130: "#90CCDD",
  140: "#B4DFEA",
  150: "#D7EFF6",
  160: "#EEF8FB",
};

const baseTheme = createLightTheme(brandRamp);

export const hotelLightTheme: Theme = {
  ...baseTheme,
  fontFamilyBase:
    "'Segoe UI', -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', Roboto, 'Helvetica Neue', sans-serif",
  borderRadiusMedium: "6px",
  borderRadiusLarge: "12px",
  borderRadiusXLarge: "16px",
  shadow4: "0 2px 6px rgba(10, 26, 34, 0.06), 0 0 1px rgba(10, 26, 34, 0.08)",
  shadow8:
    "0 8px 24px rgba(10, 26, 34, 0.09), 0 1px 3px rgba(10, 26, 34, 0.06)",
};

/** Shared Fluent 2 context for all roles and viewport sizes. */
export function DesignSystemProvider({ children }: PropsWithChildren) {
  return (
    <FluentProvider theme={hotelLightTheme} lang="zh-CN">
      {children}
    </FluentProvider>
  );
}
