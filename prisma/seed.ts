import { PrismaClient, SkillType, ContentType } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function main() {
  // ---- 1) Ensure admin exists ----
  const email = "admin@local.test";
  const password = "Admin123!";

  const existingAdmin = await prisma.admin.findUnique({ where: { email } });

  const admin =
    existingAdmin ??
    (await prisma.admin.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(password, 10),
        firstName: "Local",
        lastName: "Admin",
      },
    }));

  console.log(existingAdmin ? `Admin already exists: ${email}` : `Admin created: ${email}`);

  // ---- 2) Seed assessment default content ----
  // NOTE: reading.pdf should exist at /public/assessment/reading.pdf
  // If you don't have listening.mp3 yet, we simply skip it.
  const defaults: {
    title: string;
    skill: SkillType;
    type: ContentType;
    textBody?: string;
    assetUrl?: string;
    mimeType?: string;
  }[] = [
    {
      title: "Initial Reading Passage (PDF)",
      skill: SkillType.reading,
      type: ContentType.pdf_document,
      assetUrl: "/assessment/reading.pdf",
      mimeType: "application/pdf",
    },
    {
      title: "Initial Listening Audio",
      skill: SkillType.listening,
      type: ContentType.passage_audio,
      assetUrl: "/assessment/listening.mp3",
      mimeType: "audio/mpeg",
    },
    
    {
      title: "Initial Writing Prompt",
      skill: SkillType.writing,
      type: ContentType.writing_prompt,
      textBody: "Write 5–8 sentences about your favorite hobby.",
    },
    {
      title: "Initial Speaking Prompt",
      skill: SkillType.speaking,
      type: ContentType.speaking_prompt,
      textBody: "Speak for 60 seconds: introduce yourself and your school.",
    },
  ];

  for (const item of defaults) {


    const exists = await prisma.contentItem.findFirst({
      where: { title: item.title, isAssessmentDefault: true },
    });

    if (!exists) {
      await prisma.contentItem.create({
        data: {
          title: item.title,
          description: null,
          skill: item.skill,
          type: item.type,
          level: null,
          textBody: item.textBody ?? null,
          assetUrl: item.assetUrl ?? null,
          mimeType: item.mimeType ?? null,
          isAssessmentDefault: true,
          createdByAdminId: admin.id,
        },
      });

      console.log(`Seeded: ${item.title}`);
    } else {
      console.log(`Already seeded: ${item.title}`);
    }
  }
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
