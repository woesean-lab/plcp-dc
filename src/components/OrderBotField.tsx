import { Bot } from "lucide-react";
import type { OrderStatusResponse } from "../types";
import "./OrderBotField.css";

const fruits = [
  ["🍉", "karpuz|watermelon"], ["🍎", "elma|apple"], ["🍐", "armut|pear"],
  ["🍌", "muz|banana"], ["🍒", "kiraz|visne|cherry"], ["🍓", "cilek|strawberry"],
  ["🍇", "uzum|grape|grapes"], ["🍑", "seftali|peach"], ["🍍", "ananas|pineapple"],
  ["🍊", "portakal|mandalina|orange|tangerine"], ["🍋", "limon|lemon"],
  ["🥝", "kivi|kiwi"], ["🥭", "mango"], ["🍈", "kavun|melon"],
  ["🫐", "yaban mersini|blueberry|blueberries"], ["🥥", "hindistan cevizi|coconut"],
  ["🥑", "avokado|avocado"]
] as const;

function fruitForName(name: string) {
  const normalized = name.toLocaleLowerCase("tr-TR").normalize("NFD").replace(/\p{M}/gu, "").replace(/ı/g, "i");
  return fruits.find(([, aliases]) => new RegExp(`(?:^|[^a-z])(?:${aliases})(?=$|[^a-z])`).test(normalized))?.[0];
}

export function OrderBotField({ order }: { order: Pick<OrderStatusResponse, "botName" | "botApplicationId" | "automaticBot" | "customBot" | "joinMethod"> }) {
  if (order.joinMethod === "directly" || !(order.automaticBot || order.customBot || order.botName?.trim())) return null;
  const name = order.botName?.trim() || "Order bot";
  const fruit = fruitForName(name);
  return <span className="lookup-service-name order-bot-field" title={order.botApplicationId ? `${name} · ${order.botApplicationId}` : name}>
    <small>Bot</small>
    <strong>{fruit ? <span className="order-bot-fruit" aria-hidden="true">{fruit}</span> : <Bot className="h-3.5 w-3.5" aria-hidden="true" />}<span className="order-bot-name">{name}</span></strong>
  </span>;
}
