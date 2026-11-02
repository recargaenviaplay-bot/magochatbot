import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Confirmation = {
  title?: string;
  description: string;
  confirmLabel?: string;
  destructive?: boolean;
  positive?: boolean;
};

type ConfirmContextValue = {
  confirm: (options: Confirmation) => Promise<boolean>;
};

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const resolver = useRef<((value: boolean) => void) | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);

  function close(value: boolean) {
    resolver.current?.(value);
    resolver.current = null;
    setConfirmation(null);
  }

  function confirm(options: Confirmation) {
    return new Promise<boolean>((resolve) => {
      resolver.current?.(false);
      resolver.current = resolve;
      setConfirmation({
        title: "Confirmar ação",
        confirmLabel: "Confirmar",
        destructive: true,
        ...options,
      });
    });
  }

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      <Dialog open={Boolean(confirmation)} onOpenChange={(open) => !open && close(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{confirmation?.title}</DialogTitle>
            <DialogDescription>{confirmation?.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => close(false)}>Cancelar</Button>
            <Button
              variant={confirmation?.positive ? "default" : confirmation?.destructive === false ? "default" : "destructive"}
              className={confirmation?.positive ? "bg-success text-success-foreground hover:bg-success/90 hover:text-success-foreground" : undefined}
              onClick={() => close(true)}
            >
              {confirmation?.confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const context = useContext(ConfirmContext);
  if (!context) throw new Error("useConfirm precisa estar dentro de ConfirmProvider.");
  return context.confirm;
}
