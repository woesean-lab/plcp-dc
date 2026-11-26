import { Apple, Banana, Bot, Cherry, Citrus, Grape } from "lucide-react";
import { Avocado, Blueberries, Coconut, Kiwi, Mango, Melon, Peach, Pear, Pineapple, Strawberry, Watermelon } from "./ui/fruit-icons";
import type { OrderStatusResponse } from "../types";
import "./OrderBotField.css";

const fruits = [
  [Watermelon, "karpuz|watermelon"], [Apple, "elma|apple"], [Pear, "armut|pear"],
  [Banana, "muz|banana"], [Cherry, "kiraz|visne|cherry"], [Strawberry, "cilek|strawberry"],
  [Grape, "uzum|grape|grapes"], [Peach, "seftali|peach"], [Pineapple, "ananas|pineapple"],
  [Citrus, "portakal|mandalina|orange|tangerine"], [Citrus, "limon|lemon"],
  [Kiwi, "kivi|kiwi"], [Mango, "mango"], [Melon, "kavun|melon"],
  [Blueberries, "yaban mersini|blueberry|blueberries"], [Coconut, "hindistan cevizi|coconut"],
  [Avocado, "avokado|avocado"]
] as const;

function fruitForName(name: string) {
  const normalized = name.toLocaleLowerCase("tr-TR").normalize("NFD").replace(/\p{M}/gu, "").replace(/ı/g, "i");
  return fruits.find(([, aliases]) => new RegExp(`(?:^|[^a-z])(?:${aliases})(?=$|[^a-z])`).test(normalized))?.[0];
}

export function OrderBotField({ order }: { order: Pick<OrderStatusResponse, "botName" | "botApplicationId" | "automaticBot" | "customBot" | "joinMethod"> }) {
  if (order.joinMethod === "directly" || !(order.automaticBot || order.customBot || order.botName?.trim())) return null;
  const name = order.botName?.trim() || "Order bot";
  const Icon = fruitForName(name) || Bot;
  return <span className="lookup-service-name order-bot-field" title={order.botApplicationId ? `${name} · ${order.botApplicationId}` : name}>
    <small>Bot</small>
    <strong><Icon className="h-3.5 w-3.5" aria-hidden="true" /><span className="order-bot-name">{name}</span></strong>
  </span>;
}
