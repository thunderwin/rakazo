import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { useLingui } from "@lingui/react/macro";
import { DialogLabelsProvider, InputRevealLabelsProvider } from "@rakazo/ui-web";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { bootstrapI18n } from "../lib/i18n";
import { resolveUiLocale, type UiLocale } from "../lib/ui-locale";
import { MarkdownLinkPrompt } from "./markdown-link-prompt";

function preferredLocale(defaultLocale: UiLocale | undefined): UiLocale {
  return resolveUiLocale(defaultLocale ? { envDefault: defaultLocale } : {});
}

export function I18nBootstrap({
  children,
  defaultLocale,
}: {
  children: ReactNode;
  /** Product default used when the user has not selected a language yet. */
  defaultLocale?: UiLocale;
}) {
  const [ready, setReady] = useState(() => i18n.locale === preferredLocale(defaultLocale));

  useEffect(() => {
    let cancelled = false;
    // activateUiLocale already falls back to English on catalog failure.
    void bootstrapI18n(preferredLocale(defaultLocale)).finally(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [defaultLocale]);

  if (!ready) {
    return (
      <div
        className="grid h-full place-items-center text-muted-foreground/80"
        data-rakazo-app-state="i18n-pending"
      />
    );
  }

  return (
    <I18nProvider i18n={i18n}>
      <KitLabels>
        <MarkdownLinkPrompt>{children}</MarkdownLinkPrompt>
      </KitLabels>
    </I18nProvider>
  );
}

/** Translations for the text the UI kit draws itself. */
function KitLabels({ children }: { children: ReactNode }) {
  const { t } = useLingui();
  return (
    <InputRevealLabelsProvider show={t`Show password`} hide={t`Hide password`}>
      <DialogLabelsProvider close={t`Close`}>{children}</DialogLabelsProvider>
    </InputRevealLabelsProvider>
  );
}
