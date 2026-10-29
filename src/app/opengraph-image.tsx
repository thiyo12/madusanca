import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const alt = "Wisdom Driving Academy — one-on-one driving lessons in British Columbia";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpenGraphImage() {
  const logo = await readFile(join(process.cwd(), "public", "wisdom-logo.png"));
  const logoData = `data:image/png;base64,${logo.toString("base64")}`;

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
          alignItems: "center",
          padding: "72px",
          background: "linear-gradient(135deg, #0b1b29 0%, #18303d 100%)",
          color: "#ffffff",
        }}
      >
        <div
          style={{
            display: "flex",
            width: "100%",
            alignItems: "center",
            gap: "54px",
          }}
        >
          <div
            style={{
              display: "flex",
              width: "250px",
              height: "250px",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "28px",
              background: "#f3f8f4",
              padding: "20px",
            }}
          >
            <img alt="" src={logoData} style={{ width: 210, height: 136, objectFit: "contain" }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
            <div style={{ width: "74px", height: "7px", borderRadius: "5px", background: "#c2ee84" }} />
            <div
              style={{
                display: "flex",
                marginTop: "28px",
                fontSize: "56px",
                fontWeight: 800,
                letterSpacing: "-2px",
                lineHeight: 1.08,
              }}
            >
              Wisdom Driving Academy
            </div>
            <div style={{ display: "flex", marginTop: "25px", fontSize: "28px", color: "#dce7e8" }}>
              One-on-one driving lessons
            </div>
            <div style={{ display: "flex", marginTop: "34px", fontSize: "21px", color: "#c2ee84" }}>
              Burnaby · Vancouver · Richmond, BC
            </div>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
