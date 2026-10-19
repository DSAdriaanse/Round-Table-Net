// Small pop-up messages: toast.success("Saved"), toast.error("Failed"), toast.loading("Working...").
// Pass { id } to replace an earlier message (for example loading, then success) and
// { description } for a second line.
import { toast as show } from "@/components/ui/use-toast";

type Options = { id?: string; description?: string };
const open = new Map<string, ReturnType<typeof show>>();

function put(title: string, options: Options = {}, variant?: "destructive") {
  const handle = options.id ? open.get(options.id) : undefined;
  if (handle) {
    handle.update({ title, description: options.description, variant, open: true });
    return;
  }
  const created = show({ title, description: options.description, variant });
  if (options.id) open.set(options.id, created);
}

export const toast = {
  success: (message: string, options?: Options) => put(message, options),
  error: (message: string, options?: Options) => put(message, options, "destructive"),
  info: (message: string, options?: Options) => put(message, options),
  loading: (message: string, options?: Options) => put(message, options),
};
