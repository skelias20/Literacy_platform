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
      select: { id: true },
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
      console.log(`Seeded (assessment default): ${item.title}`);
    } else {
      console.log(`Already seeded (assessment default): ${item.title}`);
    }
  }

  // ---- 3) Seed DAILY content (NOT assessment defaults) ----
  // Put these files under: /public/daily/reading and /public/daily/listening
  const daily: {
    title: string;
    skill: SkillType;
    type: ContentType;
    textBody?: string;
    assetUrl?: string;
    mimeType?: string;
  }[] = [
    // Reading PDFs (add as many as you want)
    {
      title: "Daily Reading 1 (PDF)",
      skill: SkillType.reading,
      type: ContentType.pdf_document,
      assetUrl: "/daily/reading/reading_1.pdf",
      mimeType: "application/pdf",
    },
    {
      title: "Daily Reading 2 (PDF)",
      skill: SkillType.reading,
      type: ContentType.pdf_document,
      assetUrl: "/daily/reading/reading_2.pdf",
      mimeType: "application/pdf",
    },

    // Listening audios (add as many as you want)
    {
      title: "Daily Listening 1 (MP3)",
      skill: SkillType.listening,
      type: ContentType.passage_audio,
      assetUrl: "/daily/listening/listening_1.mp3",
      mimeType: "audio/mpeg",
    },
    {
      title: "Daily Listening 2 (MP3)",
      skill: SkillType.listening,
      type: ContentType.passage_audio,
      assetUrl: "/daily/listening/listening_2.mp3",
      mimeType: "audio/mpeg",
    },

    // Prompts (seed for demo; later we’ll let admin create from UI)
    {
      title: "Daily Writing Prompt (Text)",
      skill: SkillType.writing,
      type: ContentType.writing_prompt,
      textBody: "Write 5–7 sentences about what you did yesterday.",
    },
    {
      title: "Daily Speaking Prompt (Text)",
      skill: SkillType.speaking,
      type: ContentType.speaking_prompt,
      textBody: "Speak for ~30 seconds: describe your favorite book or story.",
    },
  ];

  for (const item of daily) {
    const exists = await prisma.contentItem.findFirst({
      where: { title: item.title, isAssessmentDefault: false },
      select: { id: true },
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
          isAssessmentDefault: false,
          createdByAdminId: admin.id,
        },
      });
      console.log(`Seeded (daily): ${item.title}`);
    } else {
      console.log(`Already seeded (daily): ${item.title}`);
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
