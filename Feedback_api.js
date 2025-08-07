import express from 'express';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

dayjs.extend(utc);
dayjs.extend(timezone);
dotenv.config();

const app = express();
app.use(express.json({ limit: '50mb' }));

const PORT = process.env.PORT || 3000;
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
const API_URL = 'https://api.mistral.ai/v1/chat/completions';

async function SkillsFeedback(skills, overallComment) {
    function validateInput(skills, overallComment) {
        if (!skills || !Array.isArray(skills) || skills.length === 0) {
            return { isValid: false, message: 'Invalid input. Please provide an array of skills.' };
        }

        if (!overallComment || typeof overallComment !== 'string' || overallComment.trim() === '') {
            return { isValid: false, message: 'Please provide an overall comment about your skills.' };
        }

        for (const skill of skills) {
            if (!skill.name || typeof skill.name !== 'string') {
                return { isValid: false, message: 'Each skill must have a valid name.' };
            }
            
            if (!skill.rating || typeof skill.rating !== 'number' || skill.rating < 1 || skill.rating > 5) {
                return { isValid: false, message: 'Each skill must have a rating between 1 and 5.' };
            }
        }

        return { isValid: true };
    }

    function parseFeedbackResponse(feedbackText) {
        const lines = feedbackText.split('\n').filter(line => line.trim() !== '');
        
        let topStrengths = '';
        let practicalExperience = '';
        let domainKnowledge = '';
        
        for (const line of lines) {
            if (line.toUpperCase().includes('TOP_STRENGTHS:') || line.toUpperCase().includes('TOP STRENGTHS:')) {
                topStrengths = line.replace(/TOP_STRENGTHS:/i, '').replace(/TOP STRENGTHS:/i, '').trim();
            } else if (line.toUpperCase().includes('PRACTICAL_EXPERIENCE:') || line.toUpperCase().includes('PRACTICAL EXPERIENCE:')) {
                practicalExperience = line.replace(/PRACTICAL_EXPERIENCE:/i, '').replace(/PRACTICAL EXPERIENCE:/i, '').trim();
            } else if (line.toUpperCase().includes('DOMAIN_KNOWLEDGE:') || line.toUpperCase().includes('DOMAIN KNOWLEDGE:')) {
                domainKnowledge = line.replace(/DOMAIN_KNOWLEDGE:/i, '').replace(/DOMAIN KNOWLEDGE:/i, '').trim();
            }
        }
        
        if (!topStrengths && !practicalExperience && !domainKnowledge) {
            const sections = feedbackText.split(/\d+\.|TOP|PRACTICAL|DOMAIN/i).filter(section => section.trim() !== '');
            if (sections.length >= 3) {
                topStrengths = sections[0].trim();
                practicalExperience = sections[1].trim();
                domainKnowledge = sections[2].trim();
            } else {
                topStrengths = 'Strong technical skills identified from assessment.';
                practicalExperience = 'Hands-on experience demonstrated through skill ratings.';
                domainKnowledge = 'Domain expertise with areas for continued development.';
            }
        }
        
        return {
            topStrengths: topStrengths || 'Strong technical skills identified from assessment.',
            practicalExperience: practicalExperience || 'Hands-on experience demonstrated through skill ratings.',
            domainKnowledge: domainKnowledge || 'Domain expertise with areas for continued development.'
        };
    }

    const validation = validateInput(skills, overallComment);
    if (!validation.isValid) {
        return {
            success: false,
            error: validation.message
        };
    }

    const skillsText = skills.map((skill, index) => 
        `${index + 1}. ${skill.name} - Rating: ${skill.rating}/5`
    ).join('\n');

    const averageRating = (skills.reduce((sum, skill) => sum + skill.rating, 0) / skills.length).toFixed(1);
    const highRatedSkills = skills.filter(skill => skill.rating >= 4).length;
    const lowRatedSkills = skills.filter(skill => skill.rating <= 2).length;

    const prompt = `
    You are an expert career coach and skills development specialist. Analyze the following skills self-assessment and provide feedback in EXACTLY these 3 categories only.

    SKILLS ASSESSMENT:
    ${skillsText}

    OVERALL SELF-ASSESSMENT COMMENT:
    "${overallComment}"

    STATISTICAL OVERVIEW:
    - Total Skills Assessed: ${skills.length}
    - Average Rating: ${averageRating}/5
    - High Performing Skills (4-5): ${highRatedSkills}
    - Skills Needing Development (1-2): ${lowRatedSkills}

    REQUIREMENTS:
    Provide feedback in EXACTLY these 3 categories only:

    1. Top Strengths: Identify the candidate's highest-rated skills and strongest capabilities based on ratings of 4-5. Focus on what they excel at.

    2. Practical Experience: Assess their hands-on experience and real-world application of their skills based on their ratings and overall comment. Focus on verified experience and practical application.

    3. Domain Knowledge: Evaluate their theoretical understanding, industry knowledge, and areas for development based on lower-rated skills and overall assessment. Include both existing domain expertise and development areas.

    Return ONLY these 3 sections with concise, professional feedback for each. Keep each section to 3-4 sentences maximum.DON'T INCLUDE THE NUMBERS IN BETWEEN THE RESPONSE LIKE 5/5 RATED. Do not include any formatting like ** or headers, just the plain text for each section. `;

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${MISTRAL_API_KEY}`
            },
            body: JSON.stringify({
                model: 'mistral-small-latest',
                messages: [
                    {
                        role: 'system',
                        content: 'You are an expert career coach. Provide concise feedback in exactly 3 categories. Return plain text without any markdown formatting.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: 0.7,
                max_tokens: 500
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Mistral API error: ${response.status} - ${errorData.error?.message || response.statusText}`);
        }

        const data = await response.json();
        const feedbackText = data.choices[0].message.content;
        
        const parsedFeedback = parseFeedbackResponse(feedbackText);
        
        return {
            success: true,
            feedback: {
                Top_strength: parsedFeedback.topStrengths,
                practical_Experience: parsedFeedback.practicalExperience,
                DOmain_Knowledge: parsedFeedback.domainKnowledge
            }
        };
    } catch (error) {
        console.error('Error generating feedback:', error);
        return {
            success: false,
            error: 'Failed to generate feedback',
            feedback: {
                Top_strength: 'Unable to generate feedback at this time.',
                practical_Experience: 'Unable to generate feedback at this time.',
                DOmain_Knowledge: 'Unable to generate feedback at this time.'
            }
        };
    }
}

app.post('/skills-feedback', async (req, res) => {
    const { skills, overallComment } = req.body;
    
    try {
        const result = await SkillsFeedback(skills, overallComment);
        res.json(result);
    } catch (error) {
        console.error('API Error:', error);
        res.status(500).json({ 
            success: false,
            error: 'Internal server error',
            createdAt: {
                "$date": dayjs().utc().format()
            }
        });
    }
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'Skills Feedback API is running',
        timestamp: dayjs().utc().format()
    });
});

app.listen(PORT, () => {
    console.log(`API running on port ${PORT}`);
});
