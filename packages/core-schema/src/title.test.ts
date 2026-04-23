import { describe, expect, it } from "vitest";
import type { ConversationBundle } from "./conversation";
import { resolveBundleTitle } from "./title";

function createBundle(title?: string, firstUserMarkdown = "详细介绍明末的越南（主要是北部红河三角洲地区）"): ConversationBundle {
  return {
    platform: "gemini",
    sourceId: "b097460849c62e47",
    url: "https://gemini.google.com/app/b097460849c62e47",
    title,
    extractedAt: new Date().toISOString(),
    participants: [
      { id: "user", role: "user", name: "User" },
      { id: "assistant", role: "assistant", name: "Gemini" },
    ],
    messages: [
      {
        id: "m1",
        role: "user",
        markdown: firstUserMarkdown,
      },
      {
        id: "m2",
        role: "assistant",
        markdown: "好的。",
      },
    ],
  };
}

describe("resolveBundleTitle", () => {
  it("prefers discovery/index titles over first-prompt fallback titles", () => {
    const bundle = createBundle("详细介绍明末的越南（主要是北部红河三角洲地区）");

    expect(resolveBundleTitle(bundle, "明末越南红河三角洲研究")).toEqual({
      title: "明末越南红河三角洲研究",
      usedFallback: false,
      unresolved: false,
    });
  });

  it("keeps a real bundle title when it is better than the fallback prompt", () => {
    const bundle = createBundle("明末越南红河三角洲研究");

    expect(resolveBundleTitle(bundle, "另一个标题")).toEqual({
      title: "明末越南红河三角洲研究",
      usedFallback: false,
      unresolved: false,
    });
  });

  it("shortens an overly long first-prompt fallback title", () => {
    const bundle = createBundle(
      "Gemini",
      "请非常详细地系统讲解一下麦克斯韦方程组在不同介质边界条件下的推导过程、物理意义、典型例题和常见误区",
    );

    expect(resolveBundleTitle(bundle)).toEqual({
      title: "请非常详细地系统讲解一下麦克斯韦方程组在不同介质边界条件下的推导过程、物理意义、典型例题和常见误",
      usedFallback: true,
      unresolved: false,
    });
  });
});
