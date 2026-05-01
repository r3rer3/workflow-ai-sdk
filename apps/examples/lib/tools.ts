import { createWorkflowTool } from "workflow-ai-sdk";
import z from "zod";

interface WeatherReport {
  city: string;
  temperatureC: number;
  condition: string;
}

export function lookupWeatherOffline(city: string): WeatherReport {
  // Deterministic "data" so the offline demo is reproducible.
  const temperatureC = 12 + (city.length % 15);
  const conditions = ["sunny", "cloudy", "rainy", "windy"];
  const condition = conditions[city.length % conditions.length] ?? "sunny";

  return {
    city,
    temperatureC,
    condition,
  };
}

export const lookupWeatherTool = createWorkflowTool({
  name: "lookup_weather",
  description: "Look up the current weather for a city.",
  inputSchema: z.object({
    city: z.string().describe("The city to look up weather for."),
  }),
  execute: async (input) => {
    return lookupWeatherOffline(input.city);
  },
});
