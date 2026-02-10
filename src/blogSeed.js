import { Blogs } from "./models/blogs.model.js";
import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config({
    path: "../.env"
})

const connectDb = async () =>{
    try {
        const connection = await mongoose.connect(`${process.env.MONGO_DB}`);
        console.log("Database Connected Successfully");
    } catch (error) {
        console.log("connection failed:",error);
        process.exit(1);
    }
}


const blogData = [
  {
    id: 1,
    slug: "how-entrepreneurs-can-use-chatgpt-as-their-business-coach",
    title: "How Entrepreneurs Can Use ChatGPT as Their Business Coach",
    img: "../assets/blog-imgs/how-entrepreneurs.webp",
    category: "AI",
    author: "Abdul Salam",
    date: "24 June 2025",
    content:
      "Starting a business can feel like navigating uncharted waters without a compass—especially for teen entrepreneurs or first-time founders without access to experienced mentors. Meanwhile, adult entrepreneurs often find personal coaching unaffordable, with rates soaring between $100–$500/hour.\n\nDespite the global business coaching market being valued at $5.34 billion and growing at over 15% annually, expert guidance remains out of reach for most. But now, there’s a new solution: AI-powered coaching.\n\nWith tools like ChatGPT now reaching over 400 million weekly users, and 40% of small businesses integrating AI, artificial intelligence has gone from novelty to necessity. Yet, many entrepreneurs still treat AI like a search engine rather than what it truly can be: a powerful, on-demand business coach.\n\nWhether you're a teen launching a side hustle or a solo founder bootstrapping a startup, AI gives you access to strategic guidance once reserved for well-funded companies.\n\n🔑 4 ChatGPT Prompts That Act Like a Business Coach\n1. Clarify Your Unique Selling Proposition (USP)\nPrompt: “I want to define my business’s USP. Break it into steps. For today, show me how to research my competitors’ USPs. Give me a focused 30-minute plan.”\nWhy this matters: A sharp USP helps you stand out in crowded markets.\n\n2. Overcome Entrepreneurial Setbacks\nPrompt: “Help me identify and overcome the most common startup challenges. Break this into 7 days of action. For today, help me research the top issues.”\nWhy this matters: Every founder hits roadblocks—cash flow, customer acquisition, burnout. AI helps you build strategies to bounce back.\n\n3. Build a Scalable Marketing Strategy\nPrompt: “I want to create a low-budget marketing plan. Break this into daily steps. For today, help me research high-impact, low-cost tactics.”\nWhy this matters: AI can help you plan, write, and optimize campaigns—even with limited time and money.\n\n4. Develop Leadership Skills\nPrompt: “I want to grow my leadership skills and mindset. What core traits should I focus on? Give me one learning task for today.”\nWhy this matters: Great startups need great leaders. ChatGPT helps you build habits of resilience, adaptability, and decision-making.\n\n💡 The Takeaway\nYou don’t need expensive coaches or elite accelerators to get expert support. With the right prompts, ChatGPT becomes a step-by-step coaching partner, helping you:\n\n- Solve problems faster\n- Build confidence\n- Take focused, daily action\n\nAI won’t replace human mentors—but it’s the next best thing, available 24/7.\n\nSave this page, bookmark the prompts, and start your weekly AI coaching journey today. Need help getting started? Reply to this email or DM us @Technohana!",
  },
  {
    id: 2,
    slug: "the-future-of-work-is-here-why-learning-microsoft-copilot-is-a-career-advantage",
    title:
      "The Future of Work Is Here: Why Learning Microsoft Copilot Is a Career Advantage",
    img: "../assets/blog-imgs/future-work.webp",
    category: "Productivity",
    author: "Abdul Salam",
    date: "13 May 2025",
    content:
      "In the past year, artificial intelligence has moved from theoretical boardroom discussions to practical workplace applications. One of the most impactful shifts? The integration of AI into everyday productivity tools. At the forefront of this change is Microsoft Copilot—an AI assistant embedded in Microsoft 365 that’s designed to streamline work, enhance creativity, and save valuable time.\n\nIf you’re still wondering how AI will affect your daily work, the answer is: it already has.\n\nMicrosoft Copilot: AI Where You Work\nCopilot isn’t another standalone app. It lives inside the Microsoft tools you already use—Word, Excel, Outlook, PowerPoint, Teams—and augments them with intelligent, context-aware assistance.\n\nHere’s how it works in practice:\n- In Word, Copilot drafts reports or refines your writing based on prompts.\n- In Excel, it analyzes complex data sets and generates formulas and visual summaries.\n- In Outlook, it helps you write more effective emails and summarizes threads.\n- In Teams, it can recap meetings and highlight key takeaways.\n- In PowerPoint, it transforms text documents into sleek presentations in seconds.\n\nThis isn’t about replacing human effort. It’s about amplifying it.\n\nThe Numbers Speak for Themselves\nAccording to Microsoft’s Work Trend Index, companies adopting AI tools like Copilot are seeing up to a 40% increase in productivity. Workers using AI assistants save nearly 30% more time on routine tasks, allowing them to focus on strategic work, deep thinking, and creative problem-solving.\n\nMeanwhile, a LinkedIn Learning report found that 82% of business leaders believe their workforce will need new skills to navigate the era of AI. The implication is clear: to remain competitive, professionals must embrace and adapt to AI-powered workflows.\n\nWhy You Should Upskill Now\nIt’s easy to think of AI as something that will affect your job tomorrow. But it’s already reshaping how work gets done today.\n\nWhether you’re a manager looking to drive efficiency, a team lead aiming for faster turnarounds, or a knowledge worker navigating an increasingly digital landscape—knowing how to use Microsoft Copilot effectively will give you a significant edge.\n\nAnd the best part? You don’t need to be a tech expert to learn it. What you do need is the right guidance.\n\nLearn Microsoft Copilot with Technohana\nAt Technohana, we’ve developed hands-on, practical training programs that take the guesswork out of using Microsoft Copilot. Our focus is simple: show you exactly how to apply AI tools to real business challenges using the Microsoft 365 environment you already rely on.\n\nWe believe that AI should feel less like a mystery—and more like a multiplier of your potential.\n\nReady to lead, not follow? Learn Microsoft Copilot with Technohana. For more details, do visit https://technohana.in/copilot",
  },
  {
    id: 3,
    slug: "microsoft-azure-training-guide-for-developers",
    title: "Microsoft Azure Training Guide for Developers",
    img: "../assets/blog-imgs/microsoft-azure.webp",
    category: "Cloud",
    author: "Abdul Salam",
    date: "17 March 2025",
    content:
      "In today's fast-moving tech world, staying ahead isn't just an option—it's a necessity. If you're just starting or looking to sharpen your skills, Microsoft Azure offers a structured learning path that can help you grow in your career. Let’s break it down in a way that makes sense.\n\nStep 1: Start Here – Build a Strong Foundation\nEvery great journey starts with a strong foundation. If you're new to cloud development, your first stop should be AZ-204: Developing Solutions for Microsoft Azure. This course gives you hands-on experience in:\n- Building and deploying cloud apps on Azure.\n- Securing applications with authentication and authorization.\n- Working with services like Azure Functions and Logic Apps.\n\nThis is your entry ticket to the Azure world, setting the stage for more specialized learning paths. Course link - https://technohana.in/course/AZ-204\n\nStep 2: Choose Your Path – Specialize Based on Your Goals\nOnce you have the basics down, it's time to find your niche. Microsoft Azure offers different paths based on your role and project requirements. Pick what excites you the most:\n\n1. Azure Cloud Developer – Design, Build, and Maintain Apps\nLove building cloud apps? Then keep going with AZ-204 to dive deeper into:\n- Running apps in containers using Kubernetes.\n- Building serverless applications with Azure Functions.\n- Monitoring and optimizing app performance in Azure.\n\n2. Azure AI Engineer – Create Smart AI Solutions\nIf you’re fascinated by artificial intelligence, AI-102: Designing and Implementing an Azure AI Solution is for you. You’ll learn how to:\n- Build AI-powered apps using Azure Cognitive Services.\n- Use Natural Language Processing (NLP) models.\n- Implement intelligent search solutions with Azure AI Search.\n\nCourse Link - https://technohana.in/course/AI-102\n\n3. Azure Cosmos DB Developer – Master Data Management\nFor developers working with large-scale data, DP-420: Designing and Implementing Cloud-Native Applications Using Azure Cosmos DB is a game-changer. It teaches you how to:\n- Develop apps that handle massive data workloads.\n- Manage consistency, security, and performance in databases.\n- Optimize database queries and indexing for better speed.\n\n4. Azure DevOps Engineer – Automate & Optimize Everything\nIf making things run smoothly excites you, then AZ-400: Designing and Implementing Microsoft DevOps Solutions is the way to go. You’ll master:\n- Automating infrastructure deployment with tools like Terraform.\n- Setting up CI/CD pipelines with Azure DevOps and GitHub Actions.\n- Implementing security best practices in DevOps workflows.\n\nCourse Link - https://technohana.in/course/AZ-400T00\n\nStep 3: Keep Growing – Explore Power Platform & Beyond\nWant to take things further? Microsoft Power Platform lets you build low-code/no-code applications to automate tasks and boost productivity. Tools like Power Apps, Power Automate, and Power BI can supercharge your workflow.\n\nYour Personalized Roadmap\nHere’s how you can structure your learning:\n- Start with AZ-204 – Learn the fundamentals of Azure development.\n- Pick a specialization based on your interest.\n- Get certified – Validate your skills with industry-recognized credentials.\n- Keep learning – Stay updated with new trends and technologies.\n\nFinal Thoughts\nThe best developers never stop learning. If you're building AI solutions, optimizing cloud apps, or streamlining DevOps, there’s always a next step. Microsoft Azure provides the right tools and training to help you grow.\n\nSo, what’s your next move?",
  },
  {
    id: 4,
    slug: "microsofts-3-billion-ai-investment-a-game-changer-for-india",
    title: "Microsoft’s $3 Billion AI Investment: A Game Changer for India",
    img: "../assets/blog-imgs/microsoft's 3B.webp",
    category: "AI",
    author: "Abdul Salam",
    date: "4 March 2025",
    content:
      "Microsoft has announced a $3 billion investment in India to enhance AI and cloud infrastructure, skill development, and innovation. This initiative aligns with India's ambition to become an AI-first nation, ensuring widespread access to AI-powered tools and education. With this investment, Microsoft aims to:\n\n- Train 10 million individuals in AI skills by 2030 under the ADVANTA(I)GE India program.\n- Support 5,000+ AI and SaaS startups and 10,000 entrepreneurs to drive innovation.\n- Expand its cloud and AI infrastructure with new datacenter campuses.\n- Promote responsible AI adoption through transparency, inclusivity, and accountability.\n\nThis investment will equip businesses, professionals, and students with the skills needed to leverage AI for growth and development.\n\nTechnoHana’s Role in India’s AI Transformation\nAt TechnoHana, we share Microsoft’s vision and are actively contributing to India's AI transformation by:\n\n1. AI Skilling & Training\nWe offer cutting-edge AI training programs focused on Microsoft’s Azure AI, Generative AI, and AI-driven business solutions. Our courses are designed to upskill professionals and businesses in:\n- Azure AI and OpenAI Services\n- Machine Learning & Data Science\n- AI for Business & Automation\n- AI-Powered Chatbots and Assistants\n\n2. AI-Powered Business Solutions\nWe help enterprises integrate AI into their workflows through:\n- SQL AI Chatbots for smart data querying\n- Document Reader AI for automated document processing\n- Review Analysis AI for customer sentiment analysis\n\n3. Supporting AI Startups & Entrepreneurs\nIndia’s startup ecosystem is rapidly adopting AI, and TechnoHana provides consulting, mentoring, and AI solution development to support early-stage AI startups. We align with Microsoft’s AI Innovation Network, ensuring startups can leverage the latest AI advancements to scale their businesses.\n\nThe Future of AI in India\nMicrosoft’s initiative is a massive leap forward for India’s AI ecosystem. As AI transforms industries, upskilling and AI adoption are no longer optional—they are essential for staying competitive. TechnoHana is proud to be a part of this journey, empowering professionals, businesses, and startups with AI-driven innovation.\n\nLet’s Shape the Future Together!\nWhat are your thoughts on AI’s impact on India’s economy and job market? Let’s discuss in the comments!",
  },
  {
    id: 5,
    slug: "bridging-the-ai-skills-gap-how-indias-workforce-is-evolving-to-lead-the-ai-revolution",
    title:
      "Bridging the AI Skills Gap: How India’s Workforce is Evolving to Lead the AI Revolution",
    category: "AI",
    img: "../assets/blog-imgs/bridging-the-ai-skills.png",
    author: "Abdul Salam",
    date: "February 10, 2025",
    content: `Artificial Intelligence (AI) is rapidly transforming India's economic and industrial landscape. A recent survey by EY India India indicates that the integration of Generative AI (GenAI) could boost the productivity of India's $254-billion IT industry by 43%-45% over the next five years. This surge is attributed to both internal adoption within the industry and the progression of client projects from proof of concept to full-scale production. Notably, roles in software development are expected to experience a productivity increase of approximately 60%, followed by BPO services at 52% and IT consulting at 47%.

However, this rapid advancement brings forth challenges, particularly in workforce readiness. A significant 97% of Indian enterprises report a lack of in-house AI talent as a primary obstacle to AI adoption. Currently, only 3% of these enterprises possess the necessary skills and resources for comprehensive AI implementation.

Recognizing the critical need for upskilling, both organizations and individuals are prioritizing AI education. A study by Emeritus India reveals that 94% of Indian professionals believe that mastering AI skills will accelerate their career growth. Furthermore, 96% are already utilizing AI and generative AI tools in their work, underscoring the nation's proactive stance in embracing AI technologies.

The Indian government is also playing a pivotal role in this transformation. The AI for India 2030 initiative, launched in collaboration with the Ministry of Electronics and Information Technology, the Office of the Principal Scientific Adviser to the Government of India, nasscom , and the World Economic Forum's Centre for the Fourth Industrial Revolution, aims to integrate AI across various sectors. This initiative emphasizes ethical, inclusive, and responsible AI adoption to position India as a global leader in AI innovation.

In the corporate sector, companies like Microsoft are making substantial investments to bolster AI capabilities in India. Microsoft has announced a $3 billion investment to expand its Azure cloud and AI capacity in the country. This plan includes setting up new data centers and training 10 million Indians in AI skills by 2030, reflecting the company's commitment to fostering AI proficiency among the Indian workforce.

As AI continues to evolve, the emphasis on upskilling becomes paramount. Organizations are encouraged to implement structured training programs, while individuals should proactively seek opportunities to enhance their AI competencies. This collective effort will ensure that India's workforce remains competitive and capable of harnessing the full potential of AI-driven innovations.

For those looking to stay ahead in this dynamic landscape, Technohana offers valuable resources and courses tailored to the latest AI trends and technologies. By leveraging such platforms, professionals can equip themselves with the skills necessary to thrive in an AI-centric future.

In conclusion, while AI presents transformative opportunities for India's economy and workforce, the successful realization of these benefits hinges on a concerted focus on upskilling. Through collaborative efforts between the government, industry, and educational platforms, India is well-positioned to lead in the global AI arena.`,
  },
  {
    id: 6,
    slug: "real-world-applications-of-ai-driving-business-impact",
    title: "Real-World Applications of AI: Driving Business Impact",
    img: "../assets/blog-imgs/real-world-applications.jpeg",
    category: "AI",
    author: "Abdul Salam",
    date: "December 24, 2024",
    content: `1. Revolutionizing Customer Support with AI
Use Case: Virtual Assistants and Chatbots AI-powered virtual assistants are transforming customer service by providing 24/7 support, handling inquiries, and resolving issues efficiently. For example, Discover uses generative AI to empower its 10,000 contact center agents, significantly improving resolution times and enhancing customer satisfaction.

Key Benefits:

Reduced response times.
Improved customer experience.
Cost savings through automation.

2. Enhancing Personalization in Retail
Use Case: AI-Driven Product Recommendations Retailers like Amazon and Walmart utilize AI to analyze customer data and provide personalized shopping experiences. By leveraging AI, these companies offer tailored recommendations based on browsing history, preferences, and purchase behavior.

Key Benefits:

Increased sales through upselling and cross-selling.
Higher customer loyalty.
Better inventory management.

3. Transforming Healthcare with AI
Use Case: Medical Imaging Analysis Organizations like Bayer are employing AI for medical imaging to improve diagnostics and streamline workflows. AI models analyze CT scans and MRIs with greater speed and accuracy, enabling radiologists to focus on critical cases.

Key Benefits:

Faster diagnosis.
Enhanced accuracy in detecting diseases.
Reduced workload for medical professionals.

4. Streamlining Manufacturing Operations
Use Case: Predictive Maintenance Manufacturers leverage AI to monitor equipment and predict maintenance needs before failures occur. For instance, Siemens uses AI to analyze sensor data and reduce downtime.

Key Benefits:

Proactive problem-solving.
Increased equipment lifespan.
Lower operational costs.

5. Revolutionizing Marketing Campaigns
Use Case: AI-Generated Content Creative agents help businesses generate high-quality marketing materials. Tools like DALL-E Open Ai and Imagen enable the creation of engaging visual content tailored to specific audiences.

Key Benefits:

Faster content production.
Enhanced creativity and personalization.
Cost-effective marketing strategies.

6. Strengthening Cybersecurity
Use Case: AI-Driven Threat Detection Companies like Palo Alto Networks use AI to identify and mitigate security threats in real-time. AI systems analyze patterns and anomalies in network activity to prevent cyberattacks.

Key Benefits:

Improved threat detection.
Faster response times.
Enhanced data security.

7. Simplifying Financial Services
Use Case: Fraud Detection Banks and financial institutions deploy AI models to detect fraudulent transactions. For instance, Mastercard uses AI algorithms to analyze millions of transactions per second to identify unusual patterns.

Key Benefits:

Reduced fraud losses.
Enhanced trust among customers.
Streamlined compliance processes.

Stay tuned for in-depth articles on each of these use cases. Technohana is committed to empowering businesses and professionals with cutting-edge AI insights and training. Subscribe to our newsletter to explore the transformative power of AI in action.`,
  },
];

async function seed() {
  try {
    await connectDb();
    console.log("✅ Connected to MongoDB");

    await Blogs.deleteMany({});
    console.log("🗑️ Old blog data deleted");

    await Blogs.insertMany(blogData);
    console.log("🌱 Blog data seeded successfully!");

    process.exit();
  } catch (error) {
    console.error("❌ Error seeding DB:", error);
    process.exit(1);
  }
}

seed();