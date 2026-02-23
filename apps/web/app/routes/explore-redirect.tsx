import { redirect } from "react-router";

export function loader() {
  return redirect("/discover", 301);
}
