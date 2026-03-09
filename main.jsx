import React from "react";
import { createRoot } from "react-dom/client";
import MahjongGame from "./mahjong.jsx";

const root = createRoot(document.getElementById("root"));
root.render(<MahjongGame />);
