import React, { useCallback, useMemo, useState } from "react";
import { Image } from "react-native";
import { withUnistyles } from "react-native-unistyles";
import { AppWindow, Globe, Monitor } from "lucide-react-native";
import type { ExternalToolPresentation } from "@getpaseo/protocol/external-tool-presentation";
import type { ToolCallPresentationIcon } from "./presentation";

const ThemedImage = withUnistyles(Image);

export function externalToolIcon(
  presentation: ExternalToolPresentation,
  fallback: ToolCallPresentationIcon,
): ToolCallPresentationIcon {
  const icon = presentation.icon ?? presentation.source?.icon;
  const kind = presentation.source?.kind;
  const icons = { browser: Globe, computer: Monitor, integration: AppWindow };
  const Fallback = kind ? icons[kind] : fallback;
  if (!icon?.url) return Fallback;
  const url = icon.url;
  const darkUrl = icon.darkUrl ?? url;
  return function ToolSourceIcon({ size = 16, color }) {
    const imageProps = useCallback(
      (theme: { colorScheme: string }) => ({
        source: { uri: theme.colorScheme === "dark" ? darkUrl : url },
      }),
      [],
    );
    const [failed, setFailed] = useState(false);
    const style = useMemo(() => ({ width: size, height: size }), [size]);
    const onError = useCallback(() => setFailed(true), []);
    if (failed) return <Fallback size={size} color={color} />;
    return (
      <ThemedImage
        uniProps={imageProps}
        style={style}
        resizeMode="contain"
        onError={onError}
        accessible={false}
      />
    );
  };
}
